/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';
import { Configuration, EntryFunc, Entry } from 'webpack';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import nextOptions from './config/next';

const APP_ENV = process.env.APP_ENV || 'development';

const GLOBALS = {
  'process.env': {
    NODE_ENV: JSON.stringify(process.env.NODE_ENV || 'development'),
    APP_ENV: JSON.stringify(process.env.APP_ENV || 'development'),
    PORT: process.env.PORT || 3000,
  },
  __DEV__: APP_ENV === 'development',
  __TEST__: APP_ENV === 'test',
  __ACC__: APP_ENV === 'acceptation',
  __PROD__: APP_ENV === 'production',
};


/**
 * NextJS does not seem to want Next Config to be typed
 * Thread: https://github.com/vercel/next.js/pull/10275
 */


// Set up our Next environment based on build phase
const config = (phase: string, config) => {
  let cfg = {
    ...config,
    distDir: nextOptions.distDir,
    // Remove x-powered-by header to remove information about the server
    poweredByHeader: false,
  };

  /**
   * BUILD CONFIG
   * This config will run in every build phase, but NOT when starting the production server
  */
  if (phase !== PHASE_PRODUCTION_SERVER) {
    // Important that we import dev dependencies only in build phases
    const webpack = require('webpack');
    const CopyWebpackPlugin = require('copy-webpack-plugin');
    const TSConfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

    cfg = {
      ...cfg,
      webpack: (config: Configuration, { isServer }) => {
        /**
         * WEBPACK CONFIG
         * Your regular Webpack configuration, except we have to work with an already existing
         * Webpack configuration from Next. When changing anything, keep in mind to preserve the
         * config of Next (unless you are trying to overwrite something) or things might break.
        */


        // Push polyfills before all other code
        const originalEntry = config.entry as EntryFunc;

        config.entry = async () => {
          const entries = await originalEntry() as Entry;
          const mainEntry = entries['main.js'] as string[];

          if (mainEntry && !mainEntry.includes(nextOptions.polyfillsPath)) {
            mainEntry.unshift(nextOptions.polyfillsPath);
          }

          return entries;
        };


        const rules = [
          {
            test: /\.svg$/,
            oneOf: [
              {
                resourceQuery: /external/,
                loader: 'url-loader',
                options: {
                  limit: 10000,
                },
              },
              {
                loader: '@svgr/webpack',
              },
            ],
          },
          {
            test: /\.(jpe?g|png|gif|ico|webp)$/,
            use: [
              {
                loader: 'url-loader',
                options: {
                  limit: 10000,
                  fallback: 'file-loader',
                  publicPath: '/_next/static/',
                  outputPath: `${isServer ? '../' : ''}static/`,
                  name: '[name].[ext]',
                },
              },
            ],
          },
        ];

        // Include all relevant directories with .tsx files that need to be transpiled
        config.module!.rules.forEach((rule) => {
          const ruleContainsTs = rule.test?.toString().includes('tsx');

          if (ruleContainsTs) {
            if (Array.isArray(rule.include)) {
              rule.include = rule.include.map((includePath) => {
                // Go down a directory to include everything from 'src'
                if (typeof includePath === 'string' && includePath.includes('src')) {
                  return path.resolve('src');
                }

                return includePath;
              });

              rule.include?.push(path.resolve('server'));
            }
          }
        });

        // Preserve Next rules while appending our rules
        config.module!.rules = [...config.module!.rules, ...rules];

        // Add plugins
        config.plugins = config.plugins!.concat(
          new webpack.DefinePlugin(GLOBALS),
          new CopyWebpackPlugin({
            patterns: [
              { from: path.resolve('public'), to: path.resolve('dist/static') },
            ],
          }),
        );

        // Add tsconfig paths to webpack
        if (config.resolve) {
          if (Array.isArray(config.resolve.plugins)) {
            config.resolve.plugins.push(new TSConfigPathsPlugin());
          } else {
            config.resolve.plugins = [new TSConfigPathsPlugin()];
          }
        }

        return config;
      },
    };
  }

  /**
   * PRODUCTION BUILD CONFIG
   * This is the config for production builds in addition to the previous build phase
  */
  if (phase === PHASE_PRODUCTION_BUILD) {
    const withOffline = require('next-offline');
    const pkg = require('./package.json');

    // Add service worker to our production build with Workbox
    cfg = withOffline({
      ...cfg,
      transformManifest: (manifest) => ['/'].concat(manifest), // add the homepage to the cache
      workboxOpts: {
        swDest: 'static/service-worker.js',
        cacheId: pkg.name,
        skipWaiting: true,
        clientsClaim: true,
        include: [/\.html$/, /\.js$/, /\.png$/],
        runtimeCaching: [
          {
            urlPattern: /^https?.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'https-calls',
              networkTimeoutSeconds: 15,
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 1 month
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    });

    // Add Bundle Analyzer if requested by script
    if (process.env.BUNDLE_ANALYZE) {
      const withBundleAnalyzer = require('@zeit/next-bundle-analyzer');

      cfg = withBundleAnalyzer({
        ...cfg,
        analyzeServer: ['server', 'both'].includes(process.env.BUNDLE_ANALYZE),
        analyzeBrowser: ['browser', 'both'].includes(process.env.BUNDLE_ANALYZE),
        bundleAnalyzerConfig: {
          server: {
            analyzerMode: 'static',
            reportFilename: '../bundle_analytics/server.html',
          },
          browser: {
            analyzerMode: 'static',
            reportFilename: '../bundle_analytics/client.html',
          },
        },
      });
    }
  }

  return cfg;
};

module.exports = config;
