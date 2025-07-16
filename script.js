const layers = [];
let activeLayer = 0;
let history = [];
let historyIndex = -1;
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let drawing = false;
let currentTool = 'brush';
let brushColor = '#22223b';
let brushSize = 5;
let startX, startY;
let savedImage = null;
let fillColor = '#fff';
let textInput = null;
let brushHairs = [];
const HAIR_COUNT = 24;

// --- Toolbar ---
const toolButtons = document.querySelectorAll('.tool');
const colorPicker = document.getElementById('colorPicker');
const sizePicker = document.getElementById('sizePicker');
const clearBtn = document.getElementById('clearBtn');
const imgBtn = document.getElementById('imgBtn');
const imgLoader = document.getElementById('imgLoader');
const saveBtn = document.getElementById('saveBtn');

function setTool(tool) {
  currentTool = tool;
  toolButtons.forEach(btn => btn.classList.remove('selected'));
  document.querySelector(`.tool[data-tool="${tool}"]`).classList.add('selected');
  if (tool === 'fill') colorPicker.value = fillColor;
  else colorPicker.value = brushColor;
}

toolButtons.forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

colorPicker.addEventListener('input', e => {
  if (currentTool === 'fill') fillColor = e.target.value;
  else brushColor = e.target.value;
});

sizePicker.addEventListener('input', e => {
  brushSize = e.target.value;
});

clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

imgBtn.addEventListener('click', () => imgLoader.click());

imgLoader.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = URL.createObjectURL(file);
});

saveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'drawing.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// --- Drawing logic ---
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches) e = e.touches[0];
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function blendColors(c1, c2, alpha) {
  // c1, c2: [r,g,b,a], alpha: 0..1
  return [
    Math.round(lerp(c1[0], c2[0], alpha)),
    Math.round(lerp(c1[1], c2[1], alpha)),
    Math.round(lerp(c1[2], c2[2], alpha)),
    255
  ];
}

function getCanvasColor(x, y) {
  const img = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  return [img[0], img[1], img[2], img[3]];
}

// --- Улучшенное смешивание и текстура кисти ---
function sRGB_to_lRGB(sRGB) {
  // sRGB: [0-255, 0-255, 0-255]
  return sRGB.map(x => {
    x = x / 255;
    return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
  });
}
function lRGB_to_sRGB(lRGB) {
  return lRGB.map(x => {
    x = Math.max(0, Math.min(1, x));
    return Math.round((x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : x * 12.92) * 255);
  });
}
function blendLuminance(a, b, t) {
  // a, b: [r,g,b,255] (0-255)
  const la = sRGB_to_lRGB(a.slice(0,3));
  const lb = sRGB_to_lRGB(b.slice(0,3));
  const lmix = la.map((v,i) => v * (1-t) + lb[i] * t);
  const rgb = lRGB_to_sRGB(lmix);
  return [rgb[0], rgb[1], rgb[2], 255];
}
function getLuminance(rgb) {
  // rgb: [r,g,b]
  const l = sRGB_to_lRGB(rgb);
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
// --- Сложные динамические формулы смешивания ---
function rgb2oklab([r, g, b]) {
  // r,g,b: 0-255
  r /= 255; g /= 255; b /= 255;
  // sRGB -> linear
  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;
  // linear RGB -> LMS
  const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b;
  const m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b;
  const s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;
  // LMS -> OKLab
  const L = Math.cbrt(l);
  const M = Math.cbrt(m);
  const S = Math.cbrt(s);
  return [
    0.2104542553*L + 0.7936177850*M - 0.0040720468*S,
    1.9779984951*L - 2.4285922050*M + 0.4505937099*S,
    0.0259040371*L + 0.7827717662*M - 0.8086757660*S
  ];
}
function oklab2rgb([L, a, b]) {
  // OKLab -> LMS
  const l = L + 0.3963377774*a + 0.2158037573*b;
  const m = L - 0.1055613458*a - 0.0638541728*b;
  const s = L - 0.0894841775*a - 1.2914855480*b;
  // LMS^3 -> linear RGB
  const l3 = l**3, m3 = m**3, s3 = s**3;
  let r = +4.0767416621*l3 - 3.3077115913*m3 + 0.2309699292*s3;
  let g = -1.2684380046*l3 + 2.6097574011*m3 - 0.3413193965*s3;
  let bb = -0.0041960863*l3 - 0.7034186147*m3 + 1.7076147010*s3;
  // linear -> sRGB
  r = r <= 0.0031308 ? 12.92*r : 1.055*Math.pow(r,1/2.4)-0.055;
  g = g <= 0.0031308 ? 12.92*g : 1.055*Math.pow(g,1/2.4)-0.055;
  bb = bb <= 0.0031308 ? 12.92*bb : 1.055*Math.pow(bb,1/2.4)-0.055;
  return [
    Math.round(Math.max(0, Math.min(1, r))*255),
    Math.round(Math.max(0, Math.min(1, g))*255),
    Math.round(Math.max(0, Math.min(1, bb))*255)
  ];
}
function blendOKLab(a, b, t) {
  // a, b: [r,g,b,255]
  const labA = rgb2oklab(a);
  const labB = rgb2oklab(b);
  const mix = [
    labA[0]*(1-t) + labB[0]*t,
    labA[1]*(1-t) + labB[1]*t,
    labA[2]*(1-t) + labB[2]*t
  ];
  const rgb = oklab2rgb(mix);
  return [rgb[0], rgb[1], rgb[2], 255];
}
function blendMultiply(a, b, t) {
  // Физическое смешивание пигментов (умножение)
  return [
    Math.round(a[0]*b[0]/255),
    Math.round(a[1]*b[1]/255),
    Math.round(a[2]*b[2]/255),
    255
  ];
}
function blendPower(a, b, t) {
  // Нелинейное смешивание (power)
  function safePow(x, y) {
    if (x === 0 && y === 0) return 0;
    return Math.pow(x, y);
  }
  return [
    Math.round(safePow(a[0], 1-t) * safePow(b[0], t)),
    Math.round(safePow(a[1], 1-t) * safePow(b[1], t)),
    Math.round(safePow(a[2], 1-t) * safePow(b[2], t)),
    255
  ];
}
function blendSpectralApprox(a, b, t) {
  // Спектральное приближение: смешиваем lRGB, затем нелинейно усиливаем насыщенность
  const la = sRGB_to_lRGB(a.slice(0,3));
  const lb = sRGB_to_lRGB(b.slice(0,3));
  let lmix = la.map((v,i) => v*(1-t) + lb[i]*t);
  // Усиливаем насыщенность
  const mean = (lmix[0]+lmix[1]+lmix[2])/3;
  lmix = lmix.map(v => mean + (v-mean)*1.25);
  const rgb = lRGB_to_sRGB(lmix);
  return [rgb[0], rgb[1], rgb[2], 255];
}
const blendModes = [
  (a,b,t) => blendLuminance(a,b,t),
  (a,b,t) => blendOKLab(a,b,t),
  (a,b,t) => blendMultiply(a,b),
  (a,b,t) => blendPower(a,b,t),
  (a,b,t) => blendSpectralApprox(a,b,t)
];
function spectralMix(underRGB, brushRGB, t) {
  // underRGB, brushRGB: [r,g,b]
  // t: 0..1 — сила влияния кисти
  const color1 = new spectral.Color(underRGB);
  const color2 = new spectral.Color(brushRGB);
  const mixed = spectral.mix([color1, 1-t], [color2, t]);
  return mixed.sRGB;
}

// --- Смешивание ---
function blendRGB(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t)
  ];
}
function rgb2cmyk(r, g, b) {
  let c = 1 - (r / 255);
  let m = 1 - (g / 255);
  let y = 1 - (b / 255);
  let k = Math.min(c, m, y);
  c = (c - k) / (1 - k) || 0;
  m = (m - k) / (1 - k) || 0;
  y = (y - k) / (1 - k) || 0;
  return [c, m, y, k];
}
function cmyk2rgb(c, m, y, k) {
  let r = (1 - Math.min(1, c * (1 - k) + k)) * 255;
  let g = (1 - Math.min(1, m * (1 - k) + k)) * 255;
  let b = (1 - Math.min(1, y * (1 - k) + k)) * 255;
  return [r, g, b];
}
function blendCMYK(a, b, t) {
  const cmykA = rgb2cmyk(...a);
  const cmykB = rgb2cmyk(...b);
  const cmyk = cmykA.map((v, i) => v * (1 - t) + cmykB[i] * t);
  return cmyk2rgb(...cmyk);
}
// LAB через chroma.js (если есть), иначе просто RGB
function blendLAB(a, b, t) {
  if (typeof chroma !== 'undefined') {
    const labA = chroma(a).lab();
    const labB = chroma(b).lab();
    const L = labA[0] * (1 - t) + labB[0] * t;
    const A = labA[1] * (1 - t) + labB[1] * t;
    const B = labA[2] * (1 - t) + labB[2] * t;
    return chroma.lab(L, A, B).rgb();
  } else {
    return blendRGB(a, b, t);
  }
}
function blendSpectral(a, b, t) {
  const color1 = new spectral.Color(a);
  const color2 = new spectral.Color(b);
  const mixed = spectral.mix([color1, 1-t], [color2, t]);
  return mixed.sRGB;
}

// --- Цифровая ручка ---
function drawBrushStroke(x, y, px, py) {
  ctx.save();
  ctx.globalAlpha = brushParams.alpha;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = brushColor;
  ctx.lineWidth = brushParams.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

// --- Изменяем обработку рисования ---
let prevX = null, prevY = null;

function startDraw(e) {
  if (currentTool === 'zoom') return; // не рисуем в режиме лупы
  drawing = true;
  const pos = getPos(e);
  startX = pos.x;
  startY = pos.y;
  prevX = pos.x;
  prevY = pos.y;
  savedImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (currentTool === 'fill') {
    floodFill(Math.floor(pos.x), Math.floor(pos.y), hexToRgba(fillColor));
    drawing = false;
  } else if (currentTool === 'text') {
    addTextInput(pos.x, pos.y);
    drawing = false;
  }
}
function draw(e) {
  if (!drawing) return;
  const pos = getPos(e);
  if (currentTool === 'brush') {
    drawBrushStroke(pos.x, pos.y, prevX, prevY);
    prevX = pos.x;
    prevY = pos.y;
  } else if (currentTool === 'eraser') {
    drawEraserStroke(pos.x, pos.y, prevX, prevY);
    prevX = pos.x;
    prevY = pos.y;
  } else if (["line", "rect", "circle"].includes(currentTool)) {
    ctx.putImageData(savedImage, 0, 0);
    drawFigure(currentTool, startX, startY, pos.x, pos.y);
  }
}
// Удаляю обработчик endDraw, так как он теперь вызывается в startDraw для fill и text

// --- Text tool ---
function addTextInput(x, y) {
  if (textInput) return;
  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Введите текст...';
  textInput.style.position = 'absolute';
  textInput.style.left = (canvas.offsetLeft + x - 40) + 'px';
  textInput.style.top = (canvas.offsetTop + y - 16) + 'px';
  textInput.style.fontSize = '18px';
  textInput.style.zIndex = 10;
  textInput.style.border = '2px solid #3a4668';
  textInput.style.borderRadius = '6px';
  textInput.style.padding = '2px 8px';
  textInput.style.outline = 'none';
  textInput.style.background = '#fff';
  document.body.appendChild(textInput);
  textInput.focus();
  textInput.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') {
      ctx.font = '18px Segoe UI, Arial';
      ctx.fillStyle = brushColor;
      ctx.fillText(textInput.value, x, y);
      document.body.removeChild(textInput);
      textInput = null;
      saveHistory();
    }
  });
  textInput.addEventListener('blur', function() {
    if (textInput) {
      document.body.removeChild(textInput);
      textInput = null;
    }
  });
}

// --- Flood fill (заливка) ---
function floodFill(x, y, fillColor) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const targetColor = [data[(y * canvas.width + x) * 4], data[(y * canvas.width + x) * 4 + 1], data[(y * canvas.width + x) * 4 + 2], data[(y * canvas.width + x) * 4 + 3]];
  if (colorsMatch(targetColor, fillColor)) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const idx = (cy * canvas.width + cx) * 4;
    const color = [data[idx], data[idx+1], data[idx+2], data[idx+3]];
    if (!colorsMatch(color, targetColor)) continue;
    data[idx] = fillColor[0];
    data[idx+1] = fillColor[1];
    data[idx+2] = fillColor[2];
    data[idx+3] = 255;
    if (cx > 0) stack.push([cx-1, cy]);
    if (cx < canvas.width-1) stack.push([cx+1, cy]);
    if (cy > 0) stack.push([cx, cy-1]);
    if (cy < canvas.height-1) stack.push([cx, cy+1]);
  }
  ctx.putImageData(imgData, 0, 0);
  saveHistory();
}
function colorsMatch(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
function hexToRgba(hex) {
  let c = hex.substring(1);
  if (c.length === 3) c = c.split('').map(x=>x+x).join('');
  const num = parseInt(c, 16);
  return [(num>>16)&255, (num>>8)&255, num&255, 255];
}

// --- UX: disable scroll on touch draw ---
canvas.addEventListener('touchstart', e => e.preventDefault(), {passive:false});
canvas.addEventListener('touchmove', e => e.preventDefault(), {passive:false});

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', startDraw);
canvas.addEventListener('touchmove', draw);
canvas.addEventListener('touchend', endDraw);

// --- Спектральные функции смешивания (адаптация spectral.js) ---
function uncompand(x) {
  return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92;
}
function compand(x) {
  return x > 0.0031308 ? 1.055 * x ** (1.0 / 2.4) - 0.055 : x * 12.92;
}
function sRGB_to_lRGB(rgb) {
  // rgb: [0-255, 0-255, 0-255]
  return rgb.map(x => uncompand(x / 255));
}
function lRGB_to_sRGB(lrgb) {
  return lrgb.map(x => Math.round(compand(x) * 255));
}
// Физически корректное смешивание двух цветов (как у красок)
function mix(a, b, t = 0.5) {
  // a, b: [r,g,b] (0-255), t: 0..1
  const la = sRGB_to_lRGB(a);
  const lb = sRGB_to_lRGB(b);
  const lmix = la.map((v, i) => v * (1 - t) + lb[i] * t);
  return lRGB_to_sRGB(lmix);
}
// Генерация палитры между двумя цветами
function palette(a, b, size) {
  const p = [];
  for (let i = 0; i < size; i++) {
    p.push(mix(a, b, i / (size - 1)));
  }
  return p;
}
// Градиент между несколькими цветами
function gradient(t, ...colors) {
  // colors: [[color, pos], ...], t: 0..1
  let a = null, b = null;
  for (const [color, pos] of colors) {
    if (pos <= t && (!a || pos > a[1])) a = [color, pos];
    if (pos >= t && (!b || pos < b[1])) b = [color, pos];
  }
  if (!a) return b[0];
  if (!b) return a[0];
  if (a[1] === b[1]) return a[0];
  const factor = (t - a[1]) / (b[1] - a[1]);
  return mix(a[0], b[0], factor);
}
// --- Добавляю режим смешивания mix для кисти ---
blendModes.push((a, b, t) => {
  // a, b: [r,g,b,255]
  const m = mix(a.slice(0,3), b.slice(0,3), t);
  return [m[0], m[1], m[2], 255];
});

// --- Настройки инструментов ---
// === Настройки инструментов ===
const toolPanels = {
  brush: document.getElementById('brush-settings'),
  eraser: document.getElementById('eraser-settings'),
  line: document.getElementById('figure-settings'),
  rect: document.getElementById('figure-settings'),
  circle: document.getElementById('figure-settings'),
  text: document.getElementById('text-settings'),
  fill: null
};
// === Трансформация (лупа/панорамирование) ===
let zoom = 1;
let panX = 0;
let panY = 0;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.2;
let isPanning = false;
let panStart = {x:0, y:0};
let panOrigin = {x:0, y:0};

// Удаляю функцию updateZoomUI и все обращения к zoomLevelSpan, zoomInBtn, zoomOutBtn, zoomResetBtn

function redrawTransformed() {
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
  ctx.clearRect(-panX/zoom, -panY/zoom, canvas.width/zoom, canvas.height/zoom);
  ctx.drawImage(savedImage, 0, 0);
}

canvas.addEventListener('mousedown', function(e) {
  if (currentTool === 'zoom') {
    isPanning = true;
    panStart = getPos(e);
    panOrigin = {x: panX, y: panY};
  }
});
canvas.addEventListener('mousemove', function(e) {
  if (currentTool === 'zoom' && isPanning) {
    const pos = getPos(e);
    panX = panOrigin.x + (pos.x - panStart.x);
    panY = panOrigin.y + (pos.y - panStart.y);
    redrawTransformed();
  }
});
canvas.addEventListener('mouseup', function(e) {
  if (currentTool === 'zoom') isPanning = false;
});
canvas.addEventListener('mouseleave', function(e) {
  if (currentTool === 'zoom') isPanning = false;
});

// При смене инструмента — показывать нужную панель и применять трансформацию
function showToolPanel(tool) {
  Object.values(toolPanels).forEach(panel => { if (panel) panel.style.display = 'none'; });
  if (toolPanels[tool]) toolPanels[tool].style.display = 'block';
  // Для рисования — всегда применять текущую трансформацию
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
}

// При рисовании — учитывать трансформацию
function getTransformedPos(e) {
  const pos = getPos(e);
  return {
    x: (pos.x - panX) / zoom,
    y: (pos.y - panY) / zoom
  };
}

// Параметры инструментов
let brushParams = { size: 5, alpha: 1 };
let eraserParams = { size: 20 };
let figureParams = { size: 3, color: '#22223b' };
let textParams = { size: 18, color: '#22223b' };

// Привязка UI к параметрам
const brushSizeInput = document.getElementById('brushSize');
const brushAlphaInput = document.getElementById('brushAlpha');
brushSizeInput.value = brushParams.size;
brushAlphaInput.value = brushParams.alpha;
brushSizeInput.oninput = e => { brushParams.size = +e.target.value; };
brushAlphaInput.oninput = e => { brushParams.alpha = +e.target.value; };

const eraserSizeInput = document.getElementById('eraserSize');
eraserSizeInput.value = eraserParams.size;
eraserSizeInput.oninput = e => { eraserParams.size = +e.target.value; };

const figureSizeInput = document.getElementById('figureSize');
const figureColorInput = document.getElementById('figureColor');
figureSizeInput.value = figureParams.size;
figureColorInput.value = figureParams.color;
figureSizeInput.oninput = e => { figureParams.size = +e.target.value; };
figureColorInput.oninput = e => { figureParams.color = e.target.value; };

const textSizeInput = document.getElementById('textSize');
const textColorInput = document.getElementById('textColor');
textSizeInput.value = textParams.size;
textColorInput.value = textParams.color;
textSizeInput.oninput = e => { textParams.size = +e.target.value; };
textColorInput.oninput = e => { textParams.color = e.target.value; };

// Переключение панелей настроек при смене инструмента
toolButtons.forEach(btn => {
  btn.addEventListener('click', () => showToolPanel(btn.dataset.tool));
});

// --- Чисто растровая кисть ---
function drawBrushStroke(x, y, px, py) {
  ctx.save();
  ctx.globalAlpha = brushParams.alpha;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = brushColor;
  ctx.lineWidth = brushParams.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}
// --- Чисто растровый ластик ---
function drawEraserStroke(x, y, px, py) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = eraserParams.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}
// --- Чисто растровые фигуры ---
function drawFigure(type, x0, y0, x1, y1) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = figureParams.color;
  ctx.lineWidth = figureParams.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (type === 'line') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  } else if (type === 'rect') {
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else if (type === 'circle') {
    const r = Math.hypot(x1 - x0, y1 - y0);
    ctx.arc(x0, y0, r, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.restore();
}
// --- Чисто растровый текст ---
function drawText(x, y, text) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${textParams.size}px Segoe UI, Arial`;
  ctx.fillStyle = textParams.color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// --- Init ---
setTool('brush');
colorPicker.value = brushColor;
sizePicker.value = brushSize; 

// === Переключатель темы ===
const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  themeToggle.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}); 

// Удаляю обработчик canvas.addEventListener('wheel', ...) и связанные с ним функции redrawAll, scale, offsetX, offsetY, savedImageCanvas, saveToBuffer, MIN_SCALE, MAX_SCALE 

// --- Undo/Redo ---
function saveHistory() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (history.length > 30) history.shift();
  historyIndex = history.length - 1;
}
function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    ctx.putImageData(history[historyIndex], 0, 0);
  }
}
function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    ctx.putImageData(history[historyIndex], 0, 0);
  }
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});
// Сохранять историю после каждого действия:
function endDraw(e) {
  if (!drawing) return;
  drawing = false;
  ctx.closePath();
  saveHistory();
}
// После очистки холста:
clearBtn.addEventListener('click', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  saveHistory();
});
// После вставки картинки:
imgLoader.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    saveHistory();
  };
  img.src = URL.createObjectURL(file);
});
// После заливки:
function floodFill(x, y, fillColor) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const targetColor = [data[(y * canvas.width + x) * 4], data[(y * canvas.width + x) * 4 + 1], data[(y * canvas.width + x) * 4 + 2], data[(y * canvas.width + x) * 4 + 3]];
  if (colorsMatch(targetColor, fillColor)) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const idx = (cy * canvas.width + cx) * 4;
    const color = [data[idx], data[idx+1], data[idx+2], data[idx+3]];
    if (!colorsMatch(color, targetColor)) continue;
    data[idx] = fillColor[0];
    data[idx+1] = fillColor[1];
    data[idx+2] = fillColor[2];
    data[idx+3] = 255;
    if (cx > 0) stack.push([cx-1, cy]);
    if (cx < canvas.width-1) stack.push([cx+1, cy]);
    if (cy > 0) stack.push([cx, cy-1]);
    if (cy < canvas.height-1) stack.push([cx, cy+1]);
  }
  ctx.putImageData(imgData, 0, 0);
  saveHistory();
}
// После добавления текста:
function addTextInput(x, y) {
  if (textInput) return;
  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Введите текст...';
  textInput.style.position = 'absolute';
  textInput.style.left = (canvas.offsetLeft + x - 40) + 'px';
  textInput.style.top = (canvas.offsetTop + y - 16) + 'px';
  textInput.style.fontSize = '18px';
  textInput.style.zIndex = 10;
  textInput.style.border = '2px solid #3a4668';
  textInput.style.borderRadius = '6px';
  textInput.style.padding = '2px 8px';
  textInput.style.outline = 'none';
  textInput.style.background = '#fff';
  document.body.appendChild(textInput);
  textInput.focus();
  textInput.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') {
      ctx.font = '18px Segoe UI, Arial';
      ctx.fillStyle = brushColor;
      ctx.fillText(textInput.value, x, y);
      document.body.removeChild(textInput);
      textInput = null;
      saveHistory();
    }
  });
  textInput.addEventListener('blur', function() {
    if (textInput) {
      document.body.removeChild(textInput);
      textInput = null;
    }
  });
}
// В начале (init):
saveHistory(); 

// === Система слоёв ===
const layersList = document.getElementById('layers-list');
const addLayerBtn = document.getElementById('addLayerBtn');
const removeLayerBtn = document.getElementById('removeLayerBtn');
const layerUpBtn = document.getElementById('layerUpBtn');
const layerDownBtn = document.getElementById('layerDownBtn');

function createLayer(name = 'Слой') {
  const layerCanvas = document.createElement('canvas');
  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;
  const layerCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
  return {
    canvas: layerCanvas,
    ctx: layerCtx,
    name,
    visible: true,
    opacity: 1
  };
}
function renderLayers() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].visible) {
      ctx.globalAlpha = layers[i].opacity;
      ctx.drawImage(layers[i].canvas, 0, 0);
    }
  }
  ctx.globalAlpha = 1;
}
function updateLayersPanel() {
  layersList.innerHTML = '';
  layers.forEach((layer, i) => {
    const div = document.createElement('div');
    div.className = 'layer-item' + (i === activeLayer ? ' active' : '');
    div.onclick = () => { activeLayer = i; updateLayersPanel(); };
    // Имя слоя
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = layer.name;
    nameInput.onchange = e => { layer.name = e.target.value; };
    div.appendChild(nameInput);
    // Видимость
    const visLabel = document.createElement('label');
    const visCheckbox = document.createElement('input');
    visCheckbox.type = 'checkbox';
    visCheckbox.checked = layer.visible;
    visCheckbox.onchange = e => { layer.visible = e.target.checked; renderLayers(); };
    visLabel.appendChild(visCheckbox);
    visLabel.appendChild(document.createTextNode('👁'));
    div.appendChild(visLabel);
    // Прозрачность
    const opLabel = document.createElement('label');
    opLabel.textContent = 'α:';
    const opRange = document.createElement('input');
    opRange.type = 'range';
    opRange.min = 0; opRange.max = 1; opRange.step = 0.01;
    opRange.value = layer.opacity;
    opRange.oninput = e => { layer.opacity = +e.target.value; renderLayers(); };
    opLabel.appendChild(opRange);
    div.appendChild(opLabel);
    layersList.appendChild(div);
  });
}
addLayerBtn.onclick = () => {
  layers.push(createLayer('Слой ' + (layers.length+1)));
  activeLayer = layers.length-1;
  updateLayersPanel();
  renderLayers();
};
removeLayerBtn.onclick = () => {
  if (layers.length > 1) {
    layers.splice(activeLayer, 1);
    activeLayer = Math.max(0, activeLayer-1);
    updateLayersPanel();
    renderLayers();
  }
};
layerUpBtn.onclick = () => {
  if (activeLayer < layers.length-1) {
    [layers[activeLayer], layers[activeLayer+1]] = [layers[activeLayer+1], layers[activeLayer]];
    activeLayer++;
    updateLayersPanel();
    renderLayers();
  }
};
layerDownBtn.onclick = () => {
  if (activeLayer > 0) {
    [layers[activeLayer], layers[activeLayer-1]] = [layers[activeLayer-1], layers[activeLayer]];
    activeLayer--;
    updateLayersPanel();
    renderLayers();
  }
};
// Инициализация слоёв
layers.push(createLayer('Фон'));
updateLayersPanel();
renderLayers();
// Все инструменты рисуют только на активном слое:
function drawBrushStroke(x, y, px, py) {
  const lctx = layers[activeLayer].ctx;
  lctx.save();
  lctx.globalAlpha = brushParams.alpha;
  lctx.globalCompositeOperation = 'source-over';
  lctx.strokeStyle = brushColor;
  lctx.lineWidth = brushParams.size;
  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  lctx.beginPath();
  lctx.moveTo(px, py);
  lctx.lineTo(x, y);
  lctx.stroke();
  lctx.restore();
  renderLayers();
}
function drawEraserStroke(x, y, px, py) {
  const lctx = layers[activeLayer].ctx;
  lctx.save();
  lctx.globalAlpha = 1;
  lctx.globalCompositeOperation = 'destination-out';
  lctx.strokeStyle = 'rgba(0,0,0,1)';
  lctx.lineWidth = eraserParams.size;
  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  lctx.beginPath();
  lctx.moveTo(px, py);
  lctx.lineTo(x, y);
  lctx.stroke();
  lctx.restore();
  renderLayers();
}
function drawFigure(type, x0, y0, x1, y1) {
  const lctx = layers[activeLayer].ctx;
  lctx.save();
  lctx.globalAlpha = 1;
  lctx.globalCompositeOperation = 'source-over';
  lctx.strokeStyle = figureParams.color;
  lctx.lineWidth = figureParams.size;
  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  lctx.beginPath();
  if (type === 'line') {
    lctx.moveTo(x0, y0);
    lctx.lineTo(x1, y1);
  } else if (type === 'rect') {
    lctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else if (type === 'circle') {
    const r = Math.hypot(x1 - x0, y1 - y0);
    lctx.arc(x0, y0, r, 0, 2 * Math.PI);
  }
  lctx.stroke();
  lctx.restore();
  renderLayers();
}
function drawText(x, y, text) {
  const lctx = layers[activeLayer].ctx;
  lctx.save();
  lctx.globalAlpha = 1;
  lctx.globalCompositeOperation = 'source-over';
  lctx.font = `${textParams.size}px Segoe UI, Arial`;
  lctx.fillStyle = textParams.color;
  lctx.fillText(text, x, y);
  lctx.restore();
  renderLayers();
}
// После очистки холста очищаем только активный слой:
clearBtn.addEventListener('click', () => {
  layers[activeLayer].ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderLayers();
  saveHistory();
});
// После вставки картинки — только в активный слой:
imgLoader.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    layers[activeLayer].ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    renderLayers();
    saveHistory();
  };
  img.src = URL.createObjectURL(file);
});
// После заливки — только в активный слой:
function floodFill(x, y, fillColor) {
  const lctx = layers[activeLayer].ctx;
  const imgData = lctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const targetColor = [data[(y * canvas.width + x) * 4], data[(y * canvas.width + x) * 4 + 1], data[(y * canvas.width + x) * 4 + 2], data[(y * canvas.width + x) * 4 + 3]];
  if (colorsMatch(targetColor, fillColor)) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const idx = (cy * canvas.width + cx) * 4;
    const color = [data[idx], data[idx+1], data[idx+2], data[idx+3]];
    if (!colorsMatch(color, targetColor)) continue;
    data[idx] = fillColor[0];
    data[idx+1] = fillColor[1];
    data[idx+2] = fillColor[2];
    data[idx+3] = 255;
    if (cx > 0) stack.push([cx-1, cy]);
    if (cx < canvas.width-1) stack.push([cx+1, cy]);
    if (cy > 0) stack.push([cx, cy-1]);
    if (cy < canvas.height-1) stack.push([cx, cy+1]);
  }
  lctx.putImageData(imgData, 0, 0);
  renderLayers();
  saveHistory();
}
// После добавления текста — только в активный слой:
function addTextInput(x, y) {
  if (textInput) return;
  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.placeholder = 'Введите текст...';
  textInput.style.position = 'absolute';
  textInput.style.left = (canvas.offsetLeft + x - 40) + 'px';
  textInput.style.top = (canvas.offsetTop + y - 16) + 'px';
  textInput.style.fontSize = '18px';
  textInput.style.zIndex = 10;
  textInput.style.border = '2px solid #3a4668';
  textInput.style.borderRadius = '6px';
  textInput.style.padding = '2px 8px';
  textInput.style.outline = 'none';
  textInput.style.background = '#fff';
  document.body.appendChild(textInput);
  textInput.focus();
  textInput.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') {
      layers[activeLayer].ctx.font = '18px Segoe UI, Arial';
      layers[activeLayer].ctx.fillStyle = brushColor;
      layers[activeLayer].ctx.fillText(textInput.value, x, y);
      document.body.removeChild(textInput);
      textInput = null;
      renderLayers();
      saveHistory();
    }
  });
  textInput.addEventListener('blur', function() {
    if (textInput) {
      document.body.removeChild(textInput);
      textInput = null;
    }
  });
}
// Undo/Redo теперь сохраняет и восстанавливает все слои:
function saveHistory() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push(layers.map(l => l.ctx.getImageData(0, 0, canvas.width, canvas.height)));
  if (history.length > 30) history.shift();
  historyIndex = history.length - 1;
}
function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    const state = history[historyIndex];
    state.forEach((img, i) => layers[i].ctx.putImageData(img, 0, 0));
    renderLayers();
  }
}
function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    const state = history[historyIndex];
    state.forEach((img, i) => layers[i].ctx.putImageData(img, 0, 0));
    renderLayers();
  }
}
// В начале (init):
saveHistory(); 