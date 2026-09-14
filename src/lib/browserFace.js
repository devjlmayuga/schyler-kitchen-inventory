let humanPromise;

async function getHuman() {
  if (!humanPromise) humanPromise = (async () => {
    const { default: Human } = await import('@vladmandic/human');
    const human = new Human({
      modelBasePath: 'https://vladmandic.github.io/human-models/models/',
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
      face: { enabled: true, detector: { enabled: true }, mesh: { enabled: true }, description: { enabled: true },
        antispoof: { enabled: true }, liveness: { enabled: true }, emotion: { enabled: false }, iris: { enabled: false } },
    });
    await human.load(); await human.warmup();
    return human;
  })();
  return humanPromise;
}

export async function scanFace(video) {
  const result = await (await getHuman()).detect(video);
  if (result.face.length !== 1) throw new Error(result.face.length ? 'Only one face may be visible' : 'No face detected');
  const face = result.face[0];
  const embedding = Array.from(face.embedding || []);
  if (!embedding.length) throw new Error('Could not create a face descriptor');
  if (face.live != null && face.live < 0.5) throw new Error('Liveness check failed. Look directly at the camera and try again');
  if (face.real != null && face.real < 0.5) throw new Error('Anti-spoof check failed. Use a live camera image');
  return embedding;
}
