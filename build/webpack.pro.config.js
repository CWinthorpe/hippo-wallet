const webpack = require('webpack');
const MinimizerPlugin = require('minimizer-webpack-plugin');
const sentrySourceMap = !!process.env.sourcemap || false;
const SecSDK = require('warden-for-js').WardenPlugin;

const config = {
  mode: 'production',
  devtool: sentrySourceMap ? 'hidden-source-map' : false,
  performance: {
    maxEntrypointSize: 2500000,
    maxAssetSize: 2500000,
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.BUILD_ENV': JSON.stringify('PRO'),
    }),
    true &&
      new SecSDK({
        dev: false,
      }),
  ].filter(Boolean),

  optimization: {
    minimize: true,
    minimizer: [
      // Upstream #4204 moved webpack 5.108.4 to minimizer-webpack-plugin
      // (webpack no longer ships terser-webpack-plugin). Hippo keeps
      // serialization: parallel minification exceeded 14 GiB RSS on ARM64
      // release builds, so minify stays single-worker for deterministic,
      // OOM-safe production packaging regardless of TERSER_PARALLEL.
      new MinimizerPlugin({
        parallel: false,
        minify: {
          implementation: MinimizerPlugin.terserMinify,
          options: {
            compress: {
              pure_funcs: ['console.log', 'console.debug', 'console.info'],
            },
          },
        },
      }),
    ],
  },
};

module.exports = config;
