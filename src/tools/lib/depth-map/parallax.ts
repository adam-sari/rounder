/*
 * The 3D photo renderer (WebGL 2). Each screen pixel marches from the nearest depth to the
 * farthest and shows the first surface its ray meets, so near things hide what's behind them
 * as the camera moves (parallax occlusion mapping), rather than smearing like a plain
 * per-pixel offset.
 */
import type { Camera } from './motion';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x, -a_pos.y) * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_depth;
uniform vec2 u_shift;
uniform float u_zoom;
uniform float u_focus;
uniform float u_scale;
uniform float u_lod;
in vec2 v_uv;
out vec4 color;
const int STEPS = 48;

// where on the photo a surface at depth d (0 far … 1 near) seen through this pixel comes from
vec2 source(float d) {
  float k = d - u_focus;
  return 0.5 + (v_uv - 0.5 - u_shift * k) / (u_scale * (1.0 + u_zoom * k));
}

void main() {
  float hit = 0.0;
  float pL = 1.0;
  float pF = 0.0;
  for (int i = 0; i <= STEPS; i++) {
    float L = 1.0 - float(i) / float(STEPS);
    float f = textureLod(u_depth, source(L), 0.0).r - L;
    if (f >= 0.0) {
      // refine between the last miss and this hit
      hit = i == 0 ? L : L + (pL - L) * f / (f - pF);
      break;
    }
    pL = L;
    pF = f;
  }
  color = vec4(textureLod(u_image, source(hit), u_lod).rgb, 1.0);
}`;

export interface DepthMap {
  /** one byte per pixel, 255 = nearest */
  data: Uint8Array;
  width: number;
  height: number;
}

export class Parallax {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private image: WebGLTexture;
  private depth: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private imageWidth = 1;

  /** throws when WebGL 2 isn't available */
  constructor(readonly canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    const program = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    gl.useProgram(program);
    this.program = program;

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['u_image', 'u_depth', 'u_shift', 'u_zoom', 'u_focus', 'u_scale', 'u_lod']) this.u[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.u.u_image, 0);
    gl.uniform1i(this.u.u_depth, 1);
    this.image = this.texture(0);
    this.depth = this.texture(1);
  }

  private texture(unit: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, unit === 0 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    return t;
  }

  setImage(img: ImageData) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.imageWidth = img.width;
  }

  setDepth(d: DepthMap) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, d.width, d.height, 0, gl.RED, gl.UNSIGNED_BYTE, d.data);
  }

  /** draws one frame at the canvas's current size; focus is the depth (0–1) that stays still */
  render(cam: Camera, focus: number, scale: number) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(this.u.u_shift, cam.x, cam.y);
    gl.uniform1f(this.u.u_zoom, cam.zoom);
    gl.uniform1f(this.u.u_focus, focus);
    gl.uniform1f(this.u.u_scale, scale);
    // mip level by hand: screen-space derivatives jump at depth edges and would pick blurry levels there
    gl.uniform1f(this.u.u_lod, Math.max(0, Math.log2(this.imageWidth / (width * scale))));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.image);
    gl.deleteTexture(this.depth);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
