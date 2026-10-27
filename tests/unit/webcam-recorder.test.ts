import { describe, expect, it } from 'vitest';
import { RESOLUTIONS, cameraConstraints, cameraSupport, captureError, conversionError, deviceChoices, micConstraints, type CaptureEnv } from '@/tools/lib/recorder/capture';

describe('camera constraints', () => {
  it('asks for a size ideally, so cameras that cannot do it still start', () => {
    const hd = RESOLUTIONS.find((r) => r.id === '1080p')!;
    expect(cameraConstraints('', hd)).toEqual({ facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    expect(cameraConstraints('cam-2', hd, 60)).toMatchObject({ deviceId: { exact: 'cam-2' }, frameRate: { ideal: 60 } });
    expect(cameraConstraints('cam-2', hd)).not.toHaveProperty('facingMode');
  });
  it('cleans up voices and pins a chosen microphone', () => {
    expect(micConstraints('')).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(micConstraints('mic-1').deviceId).toEqual({ exact: 'mic-1' });
  });
});

describe('deviceChoices', () => {
  it('keeps one kind, drops nameless placeholders and numbers unlabeled devices', () => {
    const list = [
      { deviceId: 'a', kind: 'videoinput', label: 'FaceTime HD Camera' },
      { deviceId: '', kind: 'videoinput', label: '' },
      { deviceId: 'b', kind: 'videoinput', label: '' },
      { deviceId: 'm', kind: 'audioinput', label: 'Built-in mic' },
    ] as MediaDeviceInfo[];
    expect(deviceChoices(list, 'videoinput', 'Camera')).toEqual([
      { id: 'a', label: 'FaceTime HD Camera' },
      { id: 'b', label: 'Camera 2' },
    ]);
    expect(deviceChoices(list, 'audioinput', 'Microphone')).toEqual([{ id: 'm', label: 'Built-in mic' }]);
  });
});

describe('messages', () => {
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('explains blocked, missing and busy devices', () => {
    expect(captureError(err('NotAllowedError'), 'camera')).toMatch(/blocked/);
    expect(captureError(err('NotFoundError'), 'camera and microphone')).toMatch(/they are connected/);
    expect(captureError(err('NotReadableError'), 'microphone')).toMatch(/is busy/);
    expect(captureError(err('NotAllowedError'), 'screen')).toMatch(/cancelled or blocked/);
    expect(captureError(null, 'camera')).toMatch(/couldn't start/);
  });
  it('stays quiet on a cancelled conversion', () => {
    expect(conversionError('aborted', 'Cancelled.')).toBe('');
    expect(conversionError('out-of-memory', '')).toMatch(/memory/);
    expect(conversionError('failed', 'Boom.')).toBe("The conversion didn't work. Boom.");
  });
  it('needs a secure page, getUserMedia and MediaRecorder', () => {
    const env: CaptureEnv = { secure: true, displayMedia: false, userMedia: true, recorder: true, mobile: true };
    expect(cameraSupport(env)).toBeNull();
    expect(cameraSupport({ ...env, userMedia: false })).toBe('no-camera');
    expect(cameraSupport({ ...env, recorder: false })).toBe('no-recorder');
    expect(cameraSupport({ ...env, secure: false })).toBe('insecure');
  });
});
