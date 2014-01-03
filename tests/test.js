var path = require("path"),
    http = require("http"),
    async = require("async"),
    request = require("request"),
    fsHelper = require("lively-fs-helper"),
    handler = require("../index"),
    port = 9011, testServer, testApp,
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir");

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
  return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// test server
function createServer(thenDo) {
  var server = testServer = http.createServer();
  server.on('close', function() { console.log('server for tests closed'); });
  server.listen(port, function() {
    console.log('server for tests started');
    thenDo(null, server); });
  var handlers = {};
  server.on('request', function(req, res) {
    var handler = handlers[req.method.toLowerCase()];
    if (!handler)
      throw new Error(
        'no handler for request ' + req.method + ' ' + req.url);
    handler(req, res);
  });
  testApp = {
    get: function(route, handler) {
      // FIXME, use route
      handlers['get'] = handler;
    }
  }
}

function closeServer(server, thenDo) { server.close(thenDo); }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// request helpers
function put(path, content, thenDo) {
  var url = 'http://localhost:' + port + '/' + (path || '');
  request.put(url, {body: content}, function(err, res) {
    console.log('PUT done'); thenDo && thenDo(err); });
}
function del(path, thenDo) {
  var url = 'http://localhost:' + port + '/' + (path || '');
  request(url, {method: 'DELETE'}, function(err, res) {
    console.log('DELETE done'); thenDo && thenDo(err); });
}
function get(path, thenDo) {
  var url = 'http://localhost:' + port + '/' + (path || '');
  request(url, {method: 'GET'}, function(err, res, body) {
    thenDo && thenDo(err, res, body); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var tests = {

  setUp: function (callback) {
    async.series([
      function(next) {
        var files = {
          "testDir": {
            "file1.js": "// file1 content\nfoo + bar + baz",
            "file2.js": "// file2 content\ntest test test\n\n\n\n",
            "file3.js": "// file3 content\ntest test test more test",
            "file4.js": "// file4 content\ntest test test more test"
          },
        };
        fsHelper.createDirStructure(baseDirectory, files, next);
      },
      logProgress('test files created'),
      createServer,
      logProgress('server created'),
      function(next) {
        handler.start({
          app: testApp,
          routes: [{
              route: 'combined/some.js',
              baseDirectory: baseDirectory,
              files: ['testDir/file1.js', 'testDir/file4.js', 'testDir/file3.js']
            }]
        }, next);
      },
      logProgress('handler setup')
    ], callback);
  },

  tearDown: function (callback) {
    async.series([
      function(next) { handler.close(next); },
      function(next) { testServer.close(next); },
      fsHelper.cleanupTempFiles
    ], callback);
  },

  testSimpleFileFuse: function(test) {
    var expected = "// testDir/file1.js:\n"
                 + "// file1 content\nfoo + bar + baz"
                 + "\n\n\n"
                 + "// testDir/file4.js:\n"
                 + "// file4 content\ntest test test more test"
                 + "\n\n\n"
                 + "// testDir/file3.js:\n"
                 + "// file3 content\ntest test test more test"
                 + "\n\n\n";
    get('combined/some.js', function(err, res, body) {
      test.equal(body, expected);
      test.done();
    });
  }
};

module.exports = tests;
