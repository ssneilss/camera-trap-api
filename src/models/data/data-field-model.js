const { Schema } = require('mongoose');
const utils = require('../../common/utils');
const DataFieldSystemCode = require('../const/data-field-system-code');
const DataFieldWidgetType = require('../const/data-field-widget-type');
const DataFieldState = require('../const/data-field-state');

const db = utils.getDatabaseConnection();
const model = db.model(
  'DataFieldModel',
  utils.generateSchema(
    {
      systemCode: {
        // 供判斷為何種系統預設欄位使用，null 為客製化欄位
        // This filed is index with "partialFilterExpression". Find the script at index.js.
        type: String,
        enum: DataFieldSystemCode.all(),
      },
      user: {
        // 提出審核的使用者
        type: Schema.ObjectId,
        ref: 'UserModel',
        index: {
          name: 'User',
        },
      },
      state: {
        // 欄位的審核狀態
        type: String,
        default: DataFieldState.waitForReview,
        enum: DataFieldState.all(),
      },
      title: {
        // 欄位名稱
        'zh-TW': {
          // 繁體中文
          type: String,
          required: true,
        },
      },
      widgetType: {
        // 欄位形式
        type: String,
        required: true,
        enum: DataFieldWidgetType.all(),
      },
      description: {
        // 欄位形式為輸入框時儲存輸入格式內容
        'zh-TW': {
          // 繁體中文
          type: String,
        },
      },
      options: [
        // 欄位形式為下拉選單時儲存輸入格式內容
        {
          'zh-TW': {
            // 繁體中文
            type: String,
            required: true,
          },
        },
      ],
      note: {
        // 備註
        type: String,
      },
    },
    {
      collection: 'DataFields',
    },
  ),
);

model.prototype.dump = function() {
  return {
    id: `${this._id}`,
    systemCode: this.systemCode,
    title: this.title,
    widgetType: this.widgetType,
    description: this.description,
    options: this.options.map(option => ({
      id: `${option._id}`,
      'zh-TW': option['zh-TW'],
    })),
    note: this.note,
  };
};

module.exports = model;