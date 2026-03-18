(function () {
  const SIZE = 64;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const MAX_R = SIZE * 0.58;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // 7 rings staggered evenly so motion is always visible
  const RING_COUNT = 7;
  const colors = [
    [204, 0,   0  ],  // deep red
    [212, 175, 55 ],  // gold
    [139, 0,   0  ],  // dark red
    [255, 215, 0  ],  // bright gold
    [180, 20,  20 ],  // mid red
    [230, 190, 40 ],  // warm gold
  ];

  const rings = Array.from({ length: RING_COUNT }, (_, i) => ({
    r: (MAX_R / RING_COUNT) * i,
    colorIndex: i % colors.length,
    phase: (Math.PI * 2 * i) / RING_COUNT, // wobble phase offset per ring
  }));

  const SPEED = 0.55;   // expansion speed px/frame
  const WOBBLE = 2.2;   // how much each ring wiggles

  function drawWobblyRing(ring, t) {
    const progress = ring.r / MAX_R;
    const alpha = Math.pow(1 - progress, 1.4) * 0.92;
    if (alpha < 0.02) return;

    const lineWidth = Math.max(1.2, 3.5 * (1 - progress * 0.6));
    const [r, g, b] = colors[ring.colorIndex];

    ctx.beginPath();
    const STEPS = 72;
    for (let i = 0; i <= STEPS; i++) {
      const angle = (i / STEPS) * Math.PI * 2;
      // Two overlapping sine waves for organic ripple wobble
      const w =
        Math.sin(angle * 5 + ring.phase + t * 2.1) * WOBBLE * (1 - progress * 0.5) +
        Math.sin(angle * 3 - ring.phase - t * 1.4) * WOBBLE * 0.5 * (1 - progress * 0.5);
      const rr = ring.r + w;
      const x = CX + Math.cos(angle) * rr;
      const y = CY + Math.sin(angle) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function render(ts) {
    const t = ts / 1000;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Clip everything to a circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Deep black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Subtle dark red radial glow at center
    const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, MAX_R);
    bg.addColorStop(0,   'rgba(100,0,0,0.5)');
    bg.addColorStop(0.4, 'rgba(40,0,0,0.2)');
    bg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Expand rings and recycle
    rings.forEach((ring) => {
      ring.r += SPEED;
      if (ring.r > MAX_R) {
        ring.r = 0;
        ring.colorIndex = (ring.colorIndex + 1) % colors.length;
        ring.phase = Math.random() * Math.PI * 2;
      }
      drawWobblyRing(ring, t);
    });

    // Pulsing center orb — gold core, red halo
    const pulse = 0.7 + 0.3 * Math.sin(t * 4);
    const orb = ctx.createRadialGradient(CX, CY, 0, CX, CY, 7 * pulse);
    orb.addColorStop(0,   `rgba(255,230,80,${0.95 * pulse})`);
    orb.addColorStop(0.4, `rgba(212,175,55,${0.7 * pulse})`);
    orb.addColorStop(0.75,`rgba(180,0,0,${0.4 * pulse})`);
    orb.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(CX, CY, 7 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = orb;
    ctx.fill();
    ctx.restore();

    // Update favicon
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
