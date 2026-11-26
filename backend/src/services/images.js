const sharp = require('sharp');

async function optimizeImage(buffer, options) {
  const { data, info } = await sharp(buffer, {
    failOn: 'error',
    limitInputPixels: options.maxPixels,
    sequentialRead: true,
  })
    .autoOrient()
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: options.quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height || info.width > options.maxDimension || info.height > options.maxDimension) {
    throw new Error('Dimensiones de imagen invalidas.');
  }
  return { buffer: data, mime: 'image/webp', ext: '.webp', width: info.width, height: info.height };
}

module.exports = { optimizeImage };
