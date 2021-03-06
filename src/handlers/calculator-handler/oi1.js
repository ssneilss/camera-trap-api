const moment = require('moment');
require('twix');
const mongoose = require('mongoose');
const CameraLocationModel = require('../../models/data/camera-location-model');
const CameraLocationState = require('../../models/const/camera-location-state');
const AnnotationModel = require('../../models/data/annotation-model');
const AnnotationState = require('../../models/const/annotation-state');
const ProjectTrip = require('../../models/data/project-trip-model');
const SpeciesModel = require('../../models/data/species-model');
const DataFieldModel = require('../../models/data/data-field-model');

const fetchCameraLocations = async cameraLocationIds => {
  const cameraLocations = await CameraLocationModel.where({
    _id: { $in: cameraLocationIds },
  }).where({ state: CameraLocationState.active });

  return cameraLocations;
};

const getAnnotationQuery = form => {
  const query = AnnotationModel.where({ state: AnnotationState.active })
    .populate('species')
    .populate('studyArea')
    .populate('file')
    .sort('cameraLocation time filename');

  if (form.cameraLocationIds.length) {
    query.where({
      cameraLocation: { $in: form.cameraLocationIds },
    });
  }

  if (form.speciesIds.length) {
    query.where({
      species: {
        $in: form.speciesIds,
      },
    });
  }

  if (form.startDateTime) {
    query.where({ time: { $gte: form.startDateTime } });
  }

  if (form.endDateTime) {
    query.where({ time: { $lte: form.endDateTime } });
  }

  const otherDataFields = Object.keys(form);
  if (otherDataFields.length) {
    otherDataFields.forEach(dataFieldId => {
      if (!mongoose.Types.ObjectId.isValid(dataFieldId)) {
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(dataFieldId)) {
        return;
      }
      const dataFieldValue = form[dataFieldId];
      query.where({
        fields: {
          $elemMatch: {
            dataField: dataFieldId,
            'value.text': dataFieldValue,
          },
        },
      });
    });
  }

  return query;
};

const getMonthRange = (startDate, endDate) => {
  const s = moment(startDate);
  const e = moment(endDate);

  const result = [];
  while (s.isBefore(e)) {
    result.push(s.format('YYYY-MM'));
    s.add(1, 'month');
  }
  return result;
};

module.exports = async (req, res) => {
  const form = req.query;
  const {
    cameraLocationIds = [],
    startDateTime,
    endDateTime,
    range,
    speciesIds,
  } = form;
  const calculateTimeIntervel = parseInt(form.calculateTimeIntervel || 0, 10);
  const species = await SpeciesModel.find({
    _id: { $in: speciesIds },
  });

  const cameraLocations = await fetchCameraLocations(cameraLocationIds);
  const annotationQuery = getAnnotationQuery(form);
  const annotations = await annotationQuery;

  const organismIdDataField = await DataFieldModel.findOne({
    'title.zh-TW': '個體 ID',
  });

  const trips = await ProjectTrip.find({
    'studyAreas.cameraLocations.cameraLocation': {
      $in: cameraLocationIds,
    },
  });

  const times = {};
  const totalTime = {};
  trips.forEach(t => {
    t.studyAreas.forEach(s => {
      s.cameraLocations.forEach(
        ({ cameraLocation: cameraLocationId, title, projectCameras }) => {
          projectCameras.forEach(({ startActiveDate, endActiveDate }) => {
            if (typeof times[title] === 'undefined') {
              times[title] = [];
            }

            if (typeof totalTime[title] === 'undefined') {
              totalTime[title] = 0;
            }
            const durations = moment(endActiveDate).diff(startActiveDate);
            totalTime[title] += durations;
            times[title].push({
              cameraLocationId,
              startTime: startActiveDate,
              endTime: endActiveDate,
            });
          });
        },
      );
    });
  });

  const data = [];
  const organismIdList = [];
  if (range === 'month') {
    const monthList = getMonthRange(startDateTime, endDateTime);
    species.forEach(({ _id: s }) => {
      cameraLocations.forEach(c => {
        const workingCameraRange = times[c.name];
        monthList.forEach(m => {
          let totalPics = 0;
          let lastValidAnnotationTime;
          annotations
            .filter(({ cameraLocation }) => `${cameraLocation}` === `${c._id}`)
            .filter(({ time }) => moment(time).format('YYYY-MM') === m)
            .filter(
              ({ species: { _id: annotationSpeicesId } }) =>
                `${annotationSpeicesId}` === `${s}`,
            )
            .forEach(({ time, fields }) => {
              // 考慮個體ID
              let countOrganism = false;
              if (fields.length > 0) {
                const hasOrganismId = fields.find(
                  x =>
                    x.dataField.toString() ===
                    organismIdDataField._id.toString(),
                );
                const organismId = hasOrganismId.value.text;
                if (organismIdList.indexOf(organismId) === -1) {
                  organismIdList.push(organismId);
                  countOrganism = true;
                }
              }
              if (countOrganism === true) {
                if (!lastValidAnnotationTime) {
                  lastValidAnnotationTime = time;
                  totalPics = 1;
                }
                if (
                  moment(time).diff(lastValidAnnotationTime) >
                  calculateTimeIntervel
                ) {
                  lastValidAnnotationTime = time;
                  totalPics += 1;
                }
              }
            });

          // 整理時數
          const begin = moment(m).startOf('month');
          const end = moment(m).endOf('month');
          let hours = 0;

          workingCameraRange.forEach(({ startTime, endTime }) => {
            const range1 = moment(startTime).twix(endTime);
            const range2 = moment(begin).twix(end);

            const rr = range1.intersection(range2);
            const duration = rr._end.diff(rr._start);
            hours += moment
              .duration(duration < 0 ? 0 : rr._end.diff(rr._start))
              .asHours();
          });

          const totalHours = parseFloat(hours.toFixed(4));
          data.push({
            species: s,
            cameraLocationId: c._id,
            title: c.name,
            count: parseFloat((totalPics / totalHours).toFixed(5)) * 1000,
            month: moment(m).format('M'),
            year: moment(m).format('Y'),
          });
        });
      });
    });
  } else {
    species.forEach(({ _id: s }) => {
      cameraLocations.forEach(c => {
        let total = 0;
        let lastValidAnnotationTime;
        annotations
          .filter(({ cameraLocation }) => `${cameraLocation}` === `${c._id}`)
          .filter(
            ({ species: { _id: annotationSpeicesId } }) =>
              `${annotationSpeicesId}` === `${s}`,
          )
          .forEach(({ time }) => {
            if (!lastValidAnnotationTime) {
              lastValidAnnotationTime = time;
              total = 1;
            }

            if (
              moment(time).diff(lastValidAnnotationTime) > calculateTimeIntervel
            ) {
              lastValidAnnotationTime = time;
              total += 1;
            }
          });

        data.push({
          species: s,
          cameraLocationId: c._id,
          title: c.name,
          count: total,
        });
      });
    });
  }
  res.json({
    species,
    data,
  });
};
