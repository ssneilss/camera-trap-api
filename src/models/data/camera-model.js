const mongoose = require('mongoose');
const utils = require('../../common/utils');
const CameraState = require('../const/camera-state');

// const { Schema } = mongoose;
utils.connectDatabase();
const schema = utils.generateSchema(
  {
    name: {
      // index: UniqueName
      type: String,
      required: true,
      index: {
        name: 'Name',
      },
    },
    state: {
      // 狀態
      // 相機使用軟刪除，因為報表須提供「相機撤除」的資料
      type: String,
      default: CameraState.active,
      enum: CameraState.all(),
      index: {
        name: 'State',
      },
    },
    sn: {
      // 相機序號
      type: String,
    },
    vn: {
      // 廠商維護編號
      type: String,
    },
    manufacturer: {
      // 廠牌
      type: String,
    },
    model: {
      // 型號
      type: String,
    },
  },
  {
    collection: 'Cameras',
  },
);
schema.index(
  { name: 1, state: 1 },
  {
    name: 'CamerasName',
    background: true,
    unique: true,
    partialFilterExpression: {
      state: CameraState.active,
    },
  },
);

const model = mongoose.model('CameraModel', schema);

model.prototype.dump = function() {
  const doc = {
    id: `${this._id}`,
    name: this.name,
    nickname: this.nickname,
    sn: this.sn,
    vn: this.vn,
    propertyNumber: this.propertyNumber,
    manufacturer: this.manufacturer,
    model: this.model,
    state: this.state,
  };

  return doc;
};

module.exports = model;
