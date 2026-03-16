(function () {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  let frame = 0;

  // Aurora bands: deep reds, golds, with black base
  const bands = [
    { y: 0.18, thickness: 0.22, freq: 1.8, speed: 0.55, r: 180, g: 8,   b: 8   },
    { y: 0.35, thickness: 0.18, freq: 2.2, speed: 0.40, r: 212, g: 175, b: 55  },
    { y: 0.50, thickness: 0.20, freq: 1.5, speed: 0.70, r: 160, g: 0,   b: 0   },
    { y: 0.65, thickness: 0.16, freq: 2.6, speed: 0.50, r: 255, g: 200, b: 40  },
    { y: 0.80, thickness: 0.14, freq: 1.9, speed: 0.65, r: 100, g: 0,   b: 0   },
  ];

  function render() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Deep black background with slight red glow at center
    const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 2, SIZE / 2, SIZE / 2, SIZE * 0.75);
    bg.addColorStop(0, '#1c0303');
    bg.addColorStop(1, '#000000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const t = frame / 60;

    bands.forEach((b) => {
      const cy = b.y * SIZE;
      const half = (b.thickness * SIZE) / 2;

      // Build ribbon path: top edge forward, bottom edge backward
      ctx.beginPath();
      for (let x = 0; x <= SIZE; x++) {
        const noise =
          Math.sin((x / SIZE) * Math.PI * 3 * b.freq + t * b.speed * 2.5) * half * 0.55 +
          Math.sin((x / SIZE) * Math.PI * 5 * b.freq + t * b.speed * 1.4 + 1.2) * half * 0.25;
        const y = cy - half + noise;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      for (let x = SIZE; x >= 0; x--) {
        const noise =
          Math.sin((x / SIZE) * Math.PI * 3 * b.freq + t * b.speed * 2.5 + 0.6) * half * 0.55 +
          Math.sin((x / SIZE) * Math.PI * 5 * b.freq + t * b.speed * 1.4 + 2.0) * half * 0.25;
        const y = cy + half + noise;
        ctx.lineTo(x, y);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, cy - half, 0, cy + half);
      grad.addColorStop(0,   `rgba(${b.r},${b.g},${b.b},0)`);
      grad.addColorStop(0.35, `rgba(${b.r},${b.g},${b.b},0.72)`);
      grad.addColorStop(0.65, `rgba(${b.r},${b.g},${b.b},0.72)`);
      grad.addColorStop(1,   `rgba(${b.r},${b.g},${b.b},0)`);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // Swap favicon
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');

    frame++;
    requestAnimationFrame(render);
  }

  render();
})();
