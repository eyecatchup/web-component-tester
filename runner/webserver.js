/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
var _              = require('lodash');
var chalk          = require('chalk');
var cleankill      = require('cleankill');
var express        = require('express');
var freeport       = require('freeport');
var fs             = require('fs');
var http           = require('http');
var path           = require('path');
var send           = require('send');
var serveWaterfall = require('serve-waterfall');

// Template for generated indexes.
var INDEX_TEMPLATE = _.template(fs.readFileSync(
  path.resolve(__dirname, '../data/index.html'), {encoding: 'utf-8'}
));

// We prefer serving local assets over bower assets.
var PACKAGE_ROOT = path.resolve(__dirname, '..');
var SERVE_STATIC = {  // Keys are regexps.
  '^(.*/web-component-tester|)/browser\\.js$':       path.join(PACKAGE_ROOT, 'browser.js'),
  '^(.*/web-component-tester|)/browser\\.js\\.map$': path.join(PACKAGE_ROOT, 'browser.js.map'),
};

var DEFAULT_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma':        'no-cache',
  'Expires':        0,
};

/**
 * The webserver module is a quasi-plugin. This ensures that it is hooked in a
 * sane way (for other plugins), and just follows the same flow.
 *
 * It provides a static HTTP server for serving the desired tests and WCT's
 * `browser.js`/`environment.js`.
 */
module.exports = function(wct) {
  var options = wct.options;

  wct.hook('configure', function(done) {
    // For now, you should treat all these options as an implementation detail
    // of WCT. They may be opened up for public configuration, but we need to
    // spend some time rationalizing interactions with external webservers.
    options.webserver = _.merge(options.webserver, {
      // The URL path that each test run should target.
      webRunnerPath: undefined,
      // If present, HTML content that should be served at `webRunner`.
      webRunnerContent: undefined,
      // Map of route expressions (regular expressions) to local file paths that
      // should be served by the webserver.
      staticContent: SERVE_STATIC,
    });

    if (options.verbose) options.clientOptions.verbose = true;

    // Prefix our web runner URL with the base path.
    var urlPrefix = options.webserver.urlPrefix;
    urlPrefix = urlPrefix.replace('<basename>', path.basename(options.root));
    options.webserver.webRunnerPath    = urlPrefix + '/generated-index.html';
    options.webserver.webRunnerContent = INDEX_TEMPLATE(options);

    done();
  });

  wct.hook('prepare', function(done) {
    var wsOptions = options.webserver;

    getPort(function(error, port) {
      if (error) return done(error);
      // `port` (and `webRunnerPath`) is read down the line by `BrowserRunner`.
      wsOptions.port = port;

      var app    = express();
      var server = http.createServer(app);
      // `runTests` needs a reference to this (for the socket.io endpoint).
      wct._httpServer = server;

      // Debugging information for each request.
      app.use(function(request, response, next) {
        wct.emit('log:debug', chalk.magenta(request.method), request.url);
        next();
      });

      // Mapped static content (overriding files served at the root).
      _.each(wsOptions.staticContent, function(file, url) {
        app.get(new RegExp(url), function(request, response) {
          response.set(DEFAULT_HEADERS);
          send(request, file).pipe(response);
        });
      });

      // The generated web runner, if present.
      if (wsOptions.webRunnerContent) {
        app.get(wsOptions.webRunnerPath, function(request, response) {
          response.set(DEFAULT_HEADERS);
          response.send(wsOptions.webRunnerContent);
        });
      }

      // At this point, we allow other plugins to hook and configure the
      // webserver as they please.
      wct.emitHook('prepare:webserver', app, function(error) {
        if (error) return done(error);

        // Serve up all the static assets.
        app.use(serveWaterfall(wsOptions.pathMappings, {
          root:    options.root,
          headers: DEFAULT_HEADERS,
          log:     wct.emit.bind(wct, 'log:debug'),
        }));

        app.get('/favicon.ico', function(request, response) {
          response.end();
        });

        app.use(function(request, response, next) {
          wct.emit('log:warn', '404', chalk.magenta(request.method), request.url);
          next();
        });

        server.listen(port);
        server.port = port;
        cleankill.onInterrupt(function(done) {
          server.close();
          done();
        });

        wct.emit('log:info',
          'Web server running on port', chalk.yellow(port),
          'and serving from', chalk.magenta(options.root)
        );
        done();
      });
    });
  });

  function getPort(done) {
    if (options.webserver.port) {
      done(null, options.webserver.port);
    } else {
      freeport(done);
    }
  }

};
