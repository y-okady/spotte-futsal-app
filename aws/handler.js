const launchChrome = require('@serverless-chrome/lambda');
const CDP = require('chrome-remote-interface');
const puppeteer = require('puppeteer');
const { SPOTS, SPOTS_MAP } = require('./spot');
const elasticsearch = require('elasticsearch');
const Searcher = require('./searcher').Searcher;

const createElasticsearchClient = () => {
  return new elasticsearch.Client({
    host: {
      protocol: 'https',
      host: process.env['ES_HOST'],
      port: 9243,
      auth: `${process.env['ES_USER']}:${process.env['ES_PASS']}`,
    },
    log: 'info',
  });
}

module.exports.crawl = async (event, context, callback) => {
  await launchChrome();
  const browser = await puppeteer.connect({
    browserWSEndpoint: (await CDP.Version()).webSocketDebuggerUrl
  });
  const elasticsearchClient = createElasticsearchClient();
  for (let spot of SPOTS) {
    await spot.crawler.crawl(browser, elasticsearchClient);
  }
  await browser.close();
};

module.exports.search = async (event, context, callback) => {
  const params = event.queryStringParameters;
  ['date', 'time', 'hour'].forEach(key => {
    if (!params.hasOwnProperty(key)) {
      throw new Error(`missing parameter: ${key}`);
    }
  });
  const begin = new Date(`${params.date} ${params.time}`);
  const end = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate(), begin.getHours() + Number(params.hour), begin.getMinutes());
  await new Searcher(createElasticsearchClient()).search(begin, end)
    .then(resp => {
      const hits = resp.hits.hits.map(spot => {
        const spotName = spot._source.spot;
        return {
          spot: spotName,
          courts: spot.inner_hits.courts.hits.hits.map(court => {
            return court._source.court;
          }),
          url: SPOTS_MAP[spotName].url,
          bookingUrl: SPOTS_MAP[spotName].crawler.getUrl(begin),
        };
      });
      callback(null, {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify(hits),
      })})
    .catch(err => {
      console.log(err.message);
      callback(null, {
        statusCode: 400,
        body: err.message
      })});
};