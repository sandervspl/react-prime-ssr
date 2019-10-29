import { NextConfig } from './node_modules/@types/next';
import path from 'path';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';
import nextOptions from './config/next';
import { Configuration, EntryFunc, Entry } from 'webpack';

// Set up our Next environment based on compilation phase
const config = (phase: string): NextConfig => {
  let cfg: NextConfig = {
    distDir: nextOptions.distDir,
  };

  /*
    BUILD CONFIG
  */
  if (phase !== PHASE_PRODUCTION_SERVER) {
    // Only add Webpack config for compile phases
    const webpack = require('webpack');
    const CopyWebpackPlugin = require('copy-webpack-plugin');
    const globals = require('./config/globals');

    cfg = {
      ...cfg,
      webpack: (config: Configuration, { isServer }: any) => {
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

        /*
          WEBPACK CONFIG
          Your regular Webpack configuration, except we have to work with an already existing
          Webpack configuration from Next. When changing anything, keep in mind to preserve the
          config of Next (unless you are trying to overwrite something) or things might break.
        */
        const rules = [
          // Default jsx rule from NextJS only watches files in the pages dir.
          // In our case we need to also watch files outside of that dir.
          {
            test: /\.jsx?$/,
            include: path.resolve('src'),
            // Next already handles this dir for us
            exclude: path.resolve(nextOptions.pagesDir),
            loader: 'babel-loader',
          },
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
                  publicPath: '/_next/static/images/',
                  outputPath: `${isServer ? '../' : ''}static/images/`,
                  name: '[name].[ext]',
                },
              },
            ],
          },
        ];

        // Preserve Next rules while appending our rules
        config.module!.rules = [...config.module!.rules, ...rules];

        // Add plugins
        config.plugins = config.plugins!.concat(
          new webpack.DefinePlugin(globals),
          new CopyWebpackPlugin([
            {
              from: path.resolve('public/manifest.json'),
              to: path.resolve('dist/static'),
            },
          ]),
        );

        return config;
      },
    };
  }

  /*
    ADDITIONAL PRODUCTION BUILD CONFIG
  */
  if (phase === PHASE_PRODUCTION_BUILD) {
    const withOffline = require('next-offline');
    const pkg = require('./package.json');

    // Add service worker to our production build with Workbox
    cfg = withOffline({
      ...cfg,
      workboxOpts: {
        cacheId: pkg.name,
        skipWaiting: true,
        clientsClaim: true,
        include: [/\.html$/, /\.js$/, /\.png$/],
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