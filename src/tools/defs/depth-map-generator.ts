import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'depth-map-generator',
  category: 'ai',
  name: 'Depth map & 3D photo maker',
  title: 'Depth Map Generator & 3D Photo Maker: free AI, no upload',
  h1: 'Depth map & *3D photo* maker',
  description: 'Turn any photo into an AI depth map (grayscale or color) and a moving 3D photo. Export PNG, MP4, WebM or GIF. Free, no sign-up, runs on your device.',
  tagline: 'Make a depth map from any photo, then bring it to life as a looping 3D photo.',
  keywords: ['depth map generator', 'image to depth map', 'depth map from photo', '3d photo maker', '3d photo effect', 'parallax photo', '2.5d animation', 'depth anything', 'z depth map', 'displacement map'],
  island: 'DepthMap',
  steps: [
    'Drop in a photo. The first time, the AI model (27–99 MB, depending on your device) downloads once, then runs on your device.',
    'Compare the photo with its depth map, pick grayscale or a color map, and download it as a full-size PNG.',
    'Switch to 3D photo, choose orbit, sway or dolly zoom, set the strength and still point, then save a seamless MP4, WebM or GIF loop.',
  ],
  faq: [
    {
      q: 'Which AI model does this use?',
      a: 'Depth Anything V2 Small by Lihe Yang et al., released under the Apache-2.0 license, running through Transformers.js. It uses your graphics card through WebGPU when the browser supports it, and your processor otherwise. We use the Small model because the larger Depth Anything V2 models are licensed for non-commercial use only.',
    },
    {
      q: 'How accurate is the depth map?',
      a: 'It shows relative depth, not distances in meters: brighter means closer. It is an AI estimate and can be wrong on glass, mirrors, water, sky and fine detail like hair, so check the edges before you rely on it. The map is made at up to 1600 pixels and smoothly scaled up to your photo\'s full size.',
    },
    {
      q: 'What can I use a depth map for?',
      a: 'Displacement and 3D camera moves in Blender, After Effects or DaVinci Resolve, fake background blur, depth-guided image generation (ControlNet depth), and 3D photo posts. Some apps expect near things to be dark: tick "invert" before you download.',
    },
    {
      q: 'Why do edges stretch in the 3D photo?',
      a: 'A photo has nothing behind the subject, so when the view moves, the hidden background is filled by stretching nearby pixels. Lower the depth effect, or move the still point to the subject, to keep it subtle. Exports have no watermark and no daily limit.',
    },
    filePrivacyFaq,
  ],
  related: ['background-remover', 'image-upscaler', 'photo-colorizer'],
  flagship: { elsewhere: 'Credits per photo, watermarked 3D exports', here: 'Unlimited, no watermark, on your device' },
} satisfies Tool;
