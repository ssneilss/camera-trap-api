const xmlbuilder = require('xmlbuilder');
const SpeciesModel = require('../models/data/species-model');
// const ProjectSpeciesModel = require('../models/data/project-species-model');
const SpeciesSynonyms = require('../models/const/species-synonyms');

exports.findSynonymSpecies = speciesIds =>
  SpeciesModel.where({
    _id: { $in: speciesIds },
  }).then(speciesList => {
    let foundSynonyms = [];
    speciesList.forEach(species => {
      Object.entries(SpeciesSynonyms).find(item => {
        let synonymList = [item[0]];
        if (item[1] !== '') {
          synonymList = synonymList.concat(item[1].split(';'));
        }
        if (synonymList.indexOf(species.title['zh-TW']) >= 0) {
          foundSynonyms = synonymList;
          return true;
        }
        return false;
      });
    });
    return SpeciesModel.where({
      'title.zh-TW': { $in: foundSynonyms },
    }).then(mappedSpeciesList => {
      const mappedSpeciesIds = mappedSpeciesList.map(species => species._id);
      return mappedSpeciesIds;
    });
  });

exports.createDwCA = (project, occuranceData) => {
  const projectId = project._id.toString();

  // meta.xml
  const meta = xmlbuilder
    .create('archive', { headless: true })
    .att({
      xmlns: 'http://rs.tdwg.org/dwc/text/',
      metadata: 'eml.xml',
    })
    .ele('core', {
      encoding: 'UTF-8',
      fieldsTerminatedBy: '\\t',
      linesTerminatedBy: '\\n',
      fieldsEnclosedBy: '',
      ignoreHeaderLines: '1',
      rowType: 'http://rs.tdwg.org/dwc/terms/Occurrence',
    })
    .ele('files')
    .ele('location', {}, 'occurence.txt')
    .up()
    .up()
    .ele('id', { index: 0 })
    .up()
    .ele('field', {
      index: '1',
      term: 'http://rs.tdwg.org/dwc/terms/occurenceId',
    })
    .up()
    .ele('field', {
      index: '2',
      term: 'http://rs.tdwg.org/dwc/terms/basisOfRecord',
    })
    .up()
    .ele('field', {
      index: '3',
      term: 'http://rs.tdwg.org/dwc/terms/eventTime',
    })
    .up()
    .ele('field', { index: '4', term: 'http://rs.tdwg.org/dwc/terms/country' })
    .up()
    .ele('field', {
      index: '5',
      term: 'http://rs.tdwg.org/dwc/terms/countryCode',
    })
    .up()
    .ele('field', {
      index: '6',
      term: 'http://rs.tdwg.org/dwc/terms/verbatimElevation',
    })
    .up()
    .ele('field', {
      index: '7',
      term: 'http://rs.tdwg.org/dwc/terms/decimalLatitude',
    })
    .up()
    .ele('field', {
      index: '8',
      term: 'http://rs.tdwg.org/dwc/terms/decimalLongitude',
    })
    .up()
    .ele('field', {
      index: '9',
      term: 'http://rs.tdwg.org/dwc/terms/geodeticDatum',
    })
    .up()
    .ele('field', {
      index: '10',
      term: 'http://rs.tdwg.org/dwc/terms/vernacularName',
    })
    .up()
    .end({ pretty: true });

  // eml.xml
  const CC_MAP = {
    by: 'CC-BY',
    cc0: 'CC0',
    'by-nc': 'BY-NC',
  };
  const ccLabel = project.interpretiveDataLicense
    ? CC_MAP[project.interpretiveDataLicense]
    : '';
  const eml = xmlbuilder
    .create('eml:eml', { headless: true })
    .att({
      'xmlns:eml': 'eml://ecoinformatics.org/eml-2.1.1',
      'xmlns:dc': 'http://purl.org/dc/terms/',
      'xmlns:xsi': 'ttp://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation':
        'eml://ecoinformatics.org/eml-2.1.1 http://rs.gbif.org/schema/eml-gbif-profile/1.1/eml.xsd',
      packageId: projectId,
      system: 'http://gbif.org',
      scope: 'system',
      'xml:lang': 'chi',
    })
    .ele('dataset')
    .ele('alternateIdentifier', {}, projectId)
    .up()
    .ele('title', { 'xml:lang': 'chi' }, project.title)
    .up()
    .ele('creator')
    .ele('individualName')
    .ele('surName', {}, project.principalInvestigator)
    .up()
    .up()
    .up()
    .ele('metadataProvider')
    .ele('individualName')
    .ele('surName', {}, project.principalInvestigator)
    .up()
    .up()
    .up()
    .ele('associatedParty')
    .ele('individualName')
    .ele('surName', {}, project.funder)
    .up()
    .up()
    .up()
    .ele('language', 'chi')
    .up()
    .ele('abstract')
    .ele('para', {}, project.description)
    .up()
    .up()
    .up()
    .ele('intellectualRights')
    .ele('para', {}, 'This work is licensed under a')
    .ele('ulink', {
      url: 'http://creativecommons.org/licenses/by/4.0/legalcode',
    })
    .ele(
      'citetitle',
      {},
      `Creative Commons Attribution (${ccLabel}) 4.0 License`,
    )
    .end({ pretty: true });

  const zipFiles = [
    {
      content: occuranceData, // options can refer to [http://archiverjs.com/zip-stream/ZipStream.html#entry](http://archiverjs.com/zip-stream/ZipStream.html#entry)
      name: 'occurance.csv',
      mode: '0755',
      date: new Date(),
      type: 'file',
    },
    {
      content: meta,
      name: 'meta.xml',
      mode: '0755',
      date: new Date(),
      type: 'file',
    },
    {
      content: eml,
      name: 'eml.xml',
      mode: '0755',
      date: new Date(),
      type: 'file',
    },
  ];
  return zipFiles;
};
