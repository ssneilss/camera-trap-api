const os = require('os');
const util = require('util');
const AWS = require('aws-sdk');
const config = require('config');
const kue = require('kue');
const gm = require('gm'); // this module require graphicsmagick
const mime = require('mime-types');
const mongoose = require('mongoose');
const mongooseProfiler = require('mongoose-profiler');
const mongoosePaginate = require('mongoose-paginate-v2');
const FileType = require('../models/const/file-type');
const DataFieldSystemCode = require('../models/const/data-field-system-code');
const DataFieldWidgetType = require('../models/const/data-field-widget-type');
const AnnotationFailureType = require('../models/const/annotation-failure-type');

const _s3 = new AWS.S3({
  accessKeyId: config.s3.key,
  secretAccessKey: config.s3.secret,
  region: config.s3.region,
});

let _isRegisterHandlers;
let _isConnectionLocked;
exports.connectDatabase = (autoIndex = false) => {
  /*
  Connect to database.
  @params autoIndex {bool}
   */
  if (_isConnectionLocked) {
    return;
  }
  _isConnectionLocked = true;
  if (!_isRegisterHandlers) {
    _isRegisterHandlers = true;
    mongoose.connection.on('error', error => {
      console.error('Mongoose default connection error: ', error);
    });
    mongoose.connection.on('disconnected', () => {
      console.error('Mongoose default connection disconnected.');
    });
  }
  mongoose.connect(config.database.url, {
    useNewUrlParser: true,
    connectTimeoutMS: 1000,
    reconnectTries: Number.MAX_VALUE,
    reconnectInterval: 500,
    autoIndex,
  });
};

exports.generateSchema = (model, options) => {
  /*
  Generate a instance of mongoose.Schema.
  @params model {Object}
  @params options {Object}  https://mongoosejs.com/docs/guide.html#options
  @return {mongoose.Schema}
   */
  const schema = new mongoose.Schema(
    util._extend(
      {
        createTime: {
          // 資料建立時間
          type: Date,
          default: Date.now,
          index: {
            name: 'CreateTime',
          },
        },
        updateTime: {
          // 資料修改時間
          type: Date,
          default: Date.now,
          index: {
            name: 'UpdateTime',
          },
        },
      },
      model,
    ),
    options,
  );
  schema.plugin(mongoosePaginate);
  if (config.isDebug) {
    schema.plugin(mongooseProfiler());
  }
  schema.pre('save', function(next) {
    this.increment();
    this.updateTime = Date.now();
    next();
  });
  return schema;
};

let _queue;
exports.getTaskQueue = () => {
  /*
  Get the task queue.
  @return {Queue}
   */
  if (_queue) {
    return _queue;
  }
  _queue = kue.createQueue(config.taskWorker);
  return _queue;
};

exports.getFileUrl = (fileType, filename) => {
  /*
  Get the image url.
  @param fileType {string}
  @param filename {string}
  @returns {string|undefined}
   */
  if (FileType.all().indexOf(fileType) < 0) {
    throw new Error('Error file type.');
  }
  if (!filename) {
    return;
  }
  if ([FileType.annotationCSV, FileType.annotationZIP].indexOf(fileType) >= 0) {
    return;
  }
  const mapping = {};
  mapping[FileType.projectCoverImage] = config.s3.folders.projectCovers;
  mapping[FileType.annotationImage] = config.s3.folders.annotationImages;
  mapping[FileType.annotationVideo] = config.s3.folders.annotationVideos;
  mapping[FileType.issueAttachment] = config.s3.folders.issueAttachments;
  return `${config.s3.urlPrefix}${mapping[fileType]}/${filename}`;
};

exports.calculateNewSizeWhenOversize = (
  size,
  maxWidth,
  maxHeight,
  isAllowExceeded = false,
) => {
  /*
  @param size {Object} The image size.
  @returns {Object|null}
    width: {Number}
    height: {Number}
   */
  const widthOverRatio = size.width / maxWidth;
  const heightOverRatio = size.height / maxHeight;

  if (widthOverRatio <= 1 && heightOverRatio <= 1) {
    // The image does not over size.
    return null;
  }
  if (isAllowExceeded) {
    if (widthOverRatio < heightOverRatio) {
      // Resize the width to the new width
      return {
        width: maxWidth,
        height: Math.round(size.height * (maxWidth / size.width)),
      };
    }
    // widthOverRatio >= heightOverRatio
    // Resize the height to the new height
    return {
      width: Math.round(size.width * (maxHeight / size.height)),
      height: maxHeight,
    };
  }
  // isAllowExceeded = false
  if (widthOverRatio > heightOverRatio) {
    // Resize the width to the new width
    return {
      width: maxWidth,
      height: Math.round(size.height * (maxWidth / size.width)),
    };
  }
  // widthOverRatio <= heightOverRatio
  // Resize the height to the new height
  return {
    width: Math.round(size.width * (maxHeight / size.height)),
    height: maxHeight,
  };
};

exports.resize = (buffer, width, height, isFillUp = true) =>
  /*
  @param buffer {Buffer}
  @param width {Number}
  @param height {Number}
  @param isFillUp {bool}
    true: Resize then crop the image.
    false: Resize the image and be smaller than the size.
  @returns {Promise<Object>}
    gm: {gm}
    width: {Number}
    height: {Number}
   */
  new Promise((resolve, reject) => {
    gm(buffer).size({ bufferStream: true }, function(error, size) {
      if (error) {
        return reject(error);
      }
      if (isFillUp) {
        const newSize = exports.calculateNewSizeWhenOversize(
          size,
          width,
          height,
          isFillUp,
        );
        if (newSize) {
          this.resize(newSize.width, newSize.height, '!');
          this.gravity('Center');
          this.crop(width, height);
          return resolve({
            gm: this,
            width,
            height,
          });
        }
      } else {
        const newSize = exports.calculateNewSizeWhenOversize(
          size,
          width,
          height,
          isFillUp,
        );
        if (newSize) {
          this.resize(newSize.width, newSize.height, '!');
          return resolve({
            gm: this,
            width: newSize.width,
            height: newSize.height,
          });
        }
      }
      // Keep the original size.
      resolve({
        gm: this,
        width: size.width,
        height: size.height,
      });
    });
  });

exports.uploadToS3 = (buffer, filename, isPublic) =>
  /*
  Upload the image to storage.
  @param buffer {Buffer}
  @param filename {string} The file name with path.
  @param isPublic {bool}
  @returns {Promise<Buffer>}
   */
  new Promise((resolve, reject) => {
    // upload to S3
    const params = {
      Bucket: config.s3.bucket,
      Key: filename,
      Body: buffer,
      ACL: isPublic ? 'public-read' : undefined,
      ContentType: mime.lookup(filename),
      CacheControl: 'max-age=31536000', // 365days
    };
    _s3.upload(params, error_ => {
      if (error_) {
        return reject(error_);
      }
      resolve(buffer);
    });
  });

exports.deleteS3Objects = (filenames = []) =>
  /*
  Delete objects on S3.
  @param filenames {Array<string>}
  @returns {Promise<>}
   */
  new Promise((resolve, reject) => {
    const params = {
      Bucket: config.s3.bucket,
      Delete: {
        Objects: filenames.map(filename => ({ Key: filename })),
      },
    };
    _s3.deleteObjects(params, (error, result) => {
      if (error) {
        return reject(error);
      }
      resolve(result);
    });
  });

exports.getS3Object = filename =>
  new Promise((resolve, reject) => {
    if (!filename) {
      return reject(new Error('Filename can not be empty.'));
    }
    _s3.getObject(
      {
        Bucket: config.s3.bucket,
        Key: filename,
      },
      (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      },
    );
  });

exports.getS3 = () => _s3;

exports.resizeImageAndUploadToS3 = (args = {}) => {
  /*
  Resize and upload the image to storage.
  @param args {object}
    buffer {Buffer}
    filename {string} The file name with path.
    format {string} "jpg|png|gif"
    width {Number}
    height {Number}
    quality {Number|null} The image quality. The default is 86.
    isFillUp {bool}
    isPublic {bool}
    isReturnExif {bool}
  @returns {Promise<object>}
    buffer: {Buffer}
    width: {int}
    height: {int}
    exif: {string|null}
   */
  args.quality = args.quality || 86;
  return exports
    .resize(args.buffer, args.width, args.height, args.isFillUp)
    .then(
      result =>
        new Promise((resolve, reject) => {
          if (!args.isReturnExif) {
            return resolve([result]);
          }
          result.gm.identify('%[EXIF:*]', (error, exif) => {
            if (error) {
              exports.logError(error, { filename: args.filename });
              return resolve([result]);
            }
            return resolve([result, exif]);
          });
        }),
    )
    .then(
      ([result, exif]) =>
        new Promise((resolve, reject) => {
          result.gm
            .noProfile()
            .quality(args.quality)
            .toBuffer(args.format, (error, buffer) => {
              if (error) {
                return reject(error);
              }
              Promise.all([
                result,
                exports.uploadToS3(buffer, args.filename, args.isPublic),
                exif,
              ])
                .then(results => resolve(results))
                .catch(errors => reject(errors));
            });
        }),
    )
    .then(([result, buffer, exif]) => ({
      buffer,
      width: result.width,
      height: result.height,
      exif,
    }));
};

exports.getAnonymous = () => ({ isLogin: () => false });

exports.convertCsvToAnnotations = ({
  project,
  studyAreas,
  dataFields,
  cameraLocations,
  species,
  csvObject,
  timezone,
}) => {
  /*
  @param project {ProjectModel}
  @param studyAreas {Array<StudyAreaModel>} All study areas of this project.
  @param dataFields {Array<DataFieldModel>} All data fields of this project.
  @param cameraLocations {Array<CameraLocationModel>} All camera locations of this project.
  @param species {Array<SpeciesModel>} All species of this project.
  @param csvObject {Array<Array<string>>}
  @param timezone {Number} minutes (480 -> GMT+8).
  @returns {Object}
    annotations: {Array<AnnotationModel>}
    newSpecies: {Array<SpeciesModel>}
   */
  const AnnotationModel = require('../models/data/annotation-model');
  const SpeciesModel = require('../models/data/species-model');

  const result = {
    annotations: [],
    newSpecies: [],
  };
  timezone = timezone == null ? config.defaultTimezone : timezone;
  if (!Array.isArray(csvObject) || csvObject.length < 1) {
    return result;
  }

  csvObject.forEach((items, row) => {
    if (row === 0) {
      return;
    }

    let dataOffset = 0;
    const information = {
      studyArea: null,
      cameraLocation: null,
      filename: null,
      time: null,
      species: null,
      fields: [],
      failures: [],
    };
    for (let index = 0; index < dataFields.length; index += 1) {
      const data = (items[index + dataOffset] || '').trim();
      let nextData;
      switch (dataFields[index].systemCode) {
        case DataFieldSystemCode.studyArea:
          // This is study area data, we should process the next item it is sub study area.
          nextData = (items[index + dataOffset + 1] || '').trim();
          if (nextData) {
            information.studyArea = studyAreas.find(
              x => x.title['zh-TW'] === nextData,
            );
          } else {
            information.studyArea = studyAreas.find(
              x => x.title['zh-TW'] === data,
            );
          }
          dataOffset = 1;
          break;
        case DataFieldSystemCode.cameraLocation:
          information.cameraLocation = cameraLocations.find(
            x => x.name === data,
          );
          break;
        case DataFieldSystemCode.fileName:
          information.filename = data;
          break;
        case DataFieldSystemCode.time:
          information.time = exports.parseTimeFromCSV(data, timezone);
          break;
        case DataFieldSystemCode.species:
          information.species = species.find(x => x.title['zh-TW'] === data);
          if (!information.species && data) {
            // mark this annotation use a automatically created species.
            information.failures.push(AnnotationFailureType.newSpecies);
            // find the species in the new items.
            information.species = result.newSpecies.find(
              x => x.title['zh-TW'] === data,
            );
          }
          if (!information.species && data) {
            // automatically create a new species.
            result.newSpecies.push(
              new SpeciesModel({
                project,
                title: {
                  'zh-TW': data,
                },
                index: species.length + result.newSpecies.length,
              }),
            );
            information.species =
              result.newSpecies[result.newSpecies.length - 1];
          }
          break;
        default:
          if (dataFields.widgetType === DataFieldWidgetType.time) {
            information.fields.push({
              dataField: dataFields[index],
              value: {
                text: exports.parseTimeFromCSV(data, timezone),
              },
            });
          } else if (dataFields.widgetType === DataFieldWidgetType.select) {
            information.fields.push({
              dataField: dataFields[index],
              value: {
                selectId: dataFields[index].options.find(
                  x => x['zh-TW'] === data,
                ),
              },
            });
          } else {
            // DataFieldWidgetType.text
            information.fields.push({
              dataField: dataFields[index],
              value: {
                text: data,
              },
            });
          }
      }
    }

    if (
      !information.studyArea ||
      !information.cameraLocation ||
      !information.filename ||
      !information.time
    ) {
      throw new Error(`Missing required fields at row ${row}.`);
    }
    if (
      result.annotations.find(
        x =>
          `${x.studyArea._id}` === `${information.studyArea._id}` &&
          `${x.cameraLocation._id}` === `${information.cameraLocation._id}` &&
          x.filename === information.filename &&
          x.time.getTime() === information.time.getTime(),
      )
    ) {
      // This annotation is duplicated.
      return;
    }
    result.annotations.push(
      new AnnotationModel({
        project,
        studyArea: information.studyArea,
        cameraLocation: information.cameraLocation,
        failures: information.failures,
        filename: information.filename,
        time: information.time,
        species: information.species == null ? undefined : information.species,
        customFields: information.fields,
        rawData: items,
      }),
    );
  });

  return result;
};

exports.parseTimeFromCSV = (time, timezone) => {
  /*
  Parse the time from csv.
  @param time {string} "2010-07-25 12:27:48"
  @param timezone {Number} minutes (480 -> GMT+8)
  @returns {Date}
   */
  const dateTime = new Date(`${time.replace(' ', 'T')}.000Z`);
  dateTime.setUTCMinutes(dateTime.getUTCMinutes() - timezone);
  return dateTime;
};

exports.logError = (error, extra) => {
  /*
  @param error {Error}
  @param extra {Object}
   */
  const LogModel = require('../models/data/log-model');
  if (config.isDebug) {
    console.error(error);
  }
  if (!config.enableLog) {
    return;
  }
  const log = new LogModel({
    server: os.hostname(),
    errorStack: error ? error.stack : undefined,
    extra: (() => {
      try {
        let result;
        if (extra) {
          result = JSON.stringify(extra);
        }
        return result;
      } catch (e) {
        /* empty */
      }
    })(),
  });
  log.save();
};
