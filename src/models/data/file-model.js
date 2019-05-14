const fs = require('fs');
const path = require('path');
const config = require('config');
const mongoose = require('mongoose');
const utils = require('../../common/utils');
const FileType = require('../const/file-type');
const ExchangeableImageFileModel = require('./exchangeable-image-file-model');

const { Schema } = mongoose;
utils.connectDatabase();
const schema = utils.generateSchema(
  {
    type: {
      type: String,
      required: true,
      enum: FileType.all(),
      index: {
        name: 'Type',
      },
    },
    project: {
      type: Schema.ObjectId,
      ref: 'ProjectModel',
      index: {
        name: 'Project',
      },
    },
    user: {
      // The file owner.
      type: Schema.ObjectId,
      ref: 'UserModel',
      index: {
        name: 'User',
      },
    },
    originalFilename: {
      // The original filename.
      type: String,
      required: true,
    },
    exif: {
      type: Schema.ObjectId,
      ref: 'ExchangeableImageFileModel',
    },
    size: {
      // The file total size.
      // Whe the file type is `annotation-video`, it isn't include the video from the AWS MediaConvert.
      type: Number,
    },
  },
  {
    collection: 'Files',
  },
);

schema.post('remove', file => {
  if (file.exif) {
    ExchangeableImageFileModel.deleteOne({ _id: file.exif }).catch(error => {
      utils.logError(error, file);
    });
  }
  switch (file.type) {
    case FileType.projectCoverImage:
      utils
        .deleteS3Objects([
          `${config.s3.folders.projectCovers}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    case FileType.annotationImage:
      utils
        .deleteS3Objects([
          `${config.s3.folders.annotationImages}/${file.getFilename()}`,
          `${config.s3.folders.annotationOriginalImages}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    case FileType.annotationVideo:
      utils
        .deleteS3Objects([
          `${config.s3.folders.annotationVideos}/${file.getFilename()}`,
          `${config.s3.folders.annotationOriginalVideos}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    case FileType.annotationZIP:
      utils
        .deleteS3Objects([
          `${config.s3.folders.annotationZIPs}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    case FileType.annotationCSV:
      utils
        .deleteS3Objects([
          `${config.s3.folders.annotationCSVs}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    case FileType.issueAttachment:
      utils
        .deleteS3Objects([
          `${config.s3.folders.issueAttachments}/${file.getFilename()}`,
        ])
        .catch(error => {
          utils.logError(error, file);
        });
      break;
    default:
      utils.logError(new Error('not implement'), file);
      break;
  }
});

schema.method('getUrl', function() {
  return utils.getFileUrl(this.type, this.getFilename());
});

schema.method('getExtensionName', function() {
  /*
  Get original extension filename in lower case.
  @returns {string}
   */
  return path
    .extname(this.originalFilename)
    .replace('.', '')
    .toLowerCase();
});

schema.method('getFilename', function() {
  /*
  Get the filename on S3.
  @returns {string}
   */
  if (this.type === FileType.annotationVideo) {
    return `${this._id}.mp4`;
  }
  return `${this._id}.${this.getExtensionName()}`;
});

schema.method('saveWithContent', function(source, lastModified) {
  /*
  Save the document and update the binary content to S3.
  @param content {Buffer|string} The buffer or the file path.
  @param lastModified {Date|null} This is for the video file.
  @returns {Promise<FileModel>}
   */
  let fileStat;
  if (typeof source === 'string') {
    fileStat = fs.statSync(source);
    this.size = fileStat.size;
  } else {
    // Buffer
    this.size = source.length;
  }

  return this.save().then(() => {
    switch (this.type) {
      case FileType.projectCoverImage:
        return utils
          .resizeImageAndUploadToS3({
            buffer:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            filename: `${
              config.s3.folders.projectCovers
            }/${this.getFilename()}`,
            format: this.getExtensionName(),
            width: 383,
            height: 185,
            isFillUp: true,
            isPublic: true,
          })
          .then(result => {
            this.size = result.buffer.length;
            return this.save();
          });
      case FileType.annotationImage:
        return Promise.all([
          utils.uploadToS3({
            Key: `${
              config.s3.folders.annotationOriginalImages
            }/${this.getFilename()}`,
            Body:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            ACL: 'public-read',
            StorageClass: 'STANDARD_IA',
          }),
          utils.resizeImageAndUploadToS3({
            buffer:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            filename: `${
              config.s3.folders.annotationImages
            }/${this.getFilename()}`,
            format: this.getExtensionName(),
            width: 1280,
            height: 1280,
            isFillUp: false,
            isPublic: true,
          }),
          utils.getExif(
            typeof source === 'string'
              ? fs.createReadStream(source)
              : utils.convertBufferToStream(source),
          ),
        ])
          .then(([originalBuffer, thumbnailResult, exifData]) => {
            let exif;
            if (exifData) {
              let dateTime;
              const dateTimeOriginal = exifData.DateTimeOriginal;
              if (dateTimeOriginal) {
                // dateTimeOriginal is like this "2018:05:17 09:39:29"
                dateTime = new Date(
                  `${dateTimeOriginal
                    .replace(':', '-')
                    .replace(':', '-')
                    .replace(' ', 'T')}.000Z`,
                );
                dateTime.setUTCMinutes(
                  dateTime.getUTCMinutes() - config.defaultTimezone,
                );
              }

              exif = new ExchangeableImageFileModel({
                rawData: JSON.stringify(exifData),
                make: exifData.Make,
                model: exifData.Model,
                dateTime,
              });
              this.exif = exif;
            }
            this.size += thumbnailResult.buffer.length;
            return Promise.all([this.save(), exif ? exif.save() : null]);
          })
          .then(() => this);
      case FileType.annotationVideo:
        return utils
          .uploadToS3({
            Key: `${
              config.s3.folders.annotationOriginalVideos
            }/${this.getFilename()}`,
            Body:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            StorageClass: 'STANDARD_IA',
          })
          .then(() => {
            utils.addMediaConvertJob(this).catch(error => {
              utils.logError(error, { file: this });
            });
            const exif = new ExchangeableImageFileModel({
              dateTime: lastModified || fileStat.mtime,
            });
            this.exif = exif;
            return Promise.all([this.save(), exif.save()]);
          })
          .then(() => this);
      case FileType.annotationZIP:
        return utils
          .uploadToS3({
            Key: `${config.s3.folders.annotationZIPs}/${this.getFilename()}`,
            Body:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            StorageClass: 'STANDARD_IA',
          })
          .then(() => this);
      case FileType.annotationCSV:
        return utils
          .uploadToS3({
            Key: `${config.s3.folders.annotationCSVs}/${this.getFilename()}`,
            Body:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            StorageClass: 'STANDARD_IA',
          })
          .then(() => this);
      case FileType.issueAttachment:
        return utils
          .uploadToS3({
            Key: `${config.s3.folders.issueAttachments}/${this.getFilename()}`,
            Body:
              typeof source === 'string' ? fs.createReadStream(source) : source,
            ACL: 'public-read',
          })
          .then(() => this);
      default:
        throw new Error('error type');
    }
  });
});

schema.method('dump', function() {
  return {
    id: `${this._id}`,
    type: this.type,
    originalFilename: this.originalFilename,
    filename: this.getFilename(),
    url: this.getUrl(),
    size: this.size,
  };
});

module.exports = mongoose.model('FileModel', schema);
