// app.js
import { STIMS, TEST_IMAGE } from './data.js';

console.log('App loaded');

/**********************
 * Config / Constants *
 **********************/
const DESCRIPTION_PAGE = {
  text: 'În partea stângă vedeți aranjamentul obiectelor, iar în partea dreaptă veți răspunde prin marcarea poziției indicate de instrucțiune pe cercul cu săgeată. În acest exemplu, raspunsul este indicat de linia albastră.',
  imageSrc: TEST_IMAGE ?? placeholderBanner()
};

// WebGazer / fixation config defaults
const DEFAULTS = {
  fixationMinMs: 100,
  // if gap between samples is large, close current segment
  segmentGapMaxMs: 200,
  // heatmap bin size (px)
  heatmapBinPx: 20,
};

// Calibration targets distributed across the four AOI-like quadrants.
const CAL_TARGETS = [
  { px: 8, py: 14, zone: 'LT' }, { px: 14, py: 30, zone: 'LT' }, { px: 22, py: 32, zone: 'LT' }, { px: 30, py: 36, zone: 'LT' },
  { px: 18, py: 44, zone: 'LT' }, { px: 26, py: 48, zone: 'LT' }, { px: 34, py: 52, zone: 'LT' }, { px: 20, py: 56, zone: 'LT' },
  { px: 92, py: 14, zone: 'RT' }, { px: 62, py: 32, zone: 'RT' }, { px: 72, py: 38, zone: 'RT' }, { px: 68, py: 52, zone: 'RT' },
  { px: 8, py: 92, zone: 'LB' }, { px: 14, py: 66, zone: 'LB' }, { px: 22, py: 70, zone: 'LB' }, { px: 30, py: 74, zone: 'LB' },
  { px: 18, py: 82, zone: 'LB' }, { px: 26, py: 86, zone: 'LB' }, { px: 34, py: 90, zone: 'LB' }, { px: 20, py: 94, zone: 'LB' },
  { px: 92, py: 92, zone: 'RB' }, { px: 62, py: 68, zone: 'RB' }, { px: 72, py: 74, zone: 'RB' }, { px: 68, py: 88, zone: 'RB' },
];

const CAL_DOT_SIZE_PX = 12;
const CAL_REQUIRED_CLICKS = 1;
const CAL_DWELL_MIN_MS = 0;
const CAL_GAZE_TOLERANCE_PX = 160;
const CAL_VALIDATION_TARGETS = [
  { px: 14, py: 16 },
  { px: 86, py: 16 },
  { px: 14, py: 86 },
  { px: 86, py: 86 },
];
const CAL_VALIDATION_PASS_AVG_PX = 160;
const GOOGLE_SHEETS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxviFtlgfUzUIcQWnZZxqh4l62DSOM2RiaZWRNX36oe9g_QWvQMi4im5mdrI4DT9kkSUQ/exec'; // ex: https://script.google.com/macros/s/XXX/exec
// Backward-compat alias for older calibration paths.
const CAL_POINTS = CAL_TARGETS.map(t => [t.px, t.py]);
const SKIP_CALIBRATION = false; // Set to true to skip calibration and go directly to description/practice (for testing purposes). Not recommended for actual data collection.

/**********************
 * Global App State   *
 **********************/
const state = {
  // state.page initial
 
  page: 'consent', // 'form' | 'desc' | 'practiceInfo' | 'practiceDone' | 'calibInfo' | 'calibration' | 'test' | 'summary'
  user: {
    participantId: makeId(),
    age: '',
    gender: '',
    glasses: '',
    practicedSpatialActivity: '',
    visualSpatialComputerUse: '',
    fixationMinMs: DEFAULTS.fixationMinMs
  },

  // gaze session bookkeeping
  gaze: {
    enabled: false,
    startedAtPerfMs: null, // performance.now() reference
    lastSamplePerfMs: null,
    lastX: null,
    lastY: null,
    lastPerfNowMs: null,
    // raw samples across session (for scatter/heatmap later)
    samples: [], // {pid, trialIndex, perfMs, x, y, aoi, page}
    // optional heatmap bins across session
    heatBins: new Map(), // key "bx_by" -> count
  },

  tests: STIMS.map(s => ({
    index: s.index,
    text1: s.text1,
    text2: s.text2,
    text3: s.text3,
    text4: s.text4,
    text5: s.text5,
    expectedAngle: s.expectedAngle,
    controlLineDraw: s.controlLineDraw,

    // task metrics
    startPerfMs: null,
    submittedPerfMs: null,
    responseTimeMs: null,
    userAngleDeg: null,
    diffDeg: null,

    // AOI metrics per trial:
    // aoiStats: { LT: {...}, RT: {...}, LB: {...}, RB: {...} }
    aoiStats: null,

    // internal: per-trial streaming trackers
    _aoiRuntime: null
  })),

  currentTestIndex: 0,
  // runtime AOI rects on test page
  currentAOIRects: null, // { LT: DOMRect, RT: DOMRect, LB: DOMRect, RB: DOMRect }
  summarySaveStatus: ''
};

/**********************
 * Boot / Render root *
 **********************/
const app = document.getElementById('app');
applyPageOverrideFromUrl();
render();

function applyPageOverrideFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('page');
    const allowed = new Set(['consent', 'form', 'desc', 'practiceInfo', 'practiceDone', 'calibInfo', 'calibration', 'test', 'summary']);
    if (p && allowed.has(p)) state.page = p;
  } catch (_) {
    // Ignore malformed URL params.
  }
}

function render() {
  if (state.page === 'consent') renderConsent();
  else if (state.page === 'form') renderForm();
  else if (state.page === 'desc') renderDescription();
  else if (state.page === 'practiceInfo') renderPracticeInfo();
  else if (state.page === 'practiceDone') renderPracticeDone();
  else if (state.page === 'calibInfo') renderCalibrationInfo();
  else if (state.page === 'calibration') renderCalibration();
  else if (state.page === 'test') renderTest(state.currentTestIndex);
  else if (state.page === 'summary') renderSummary();
}

function setWebGazerPredictionPoints(visible) {
  try {
    if (window.webgazer && typeof window.webgazer.showPredictionPoints === 'function') {
      window.webgazer.showPredictionPoints(visible);
    }
  } catch (_) {
    // Ignore WebGazer overlay toggle issues.
  }
}

/**********************
 * Pages              *
 **********************/
function renderForm() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(
    el('h1', {}, 'Date participant'),
    el('p', { class: 'hint' }, 'Completați datele și apăsați Continuați.')
  );

  const form = el('div', { class: 'row' });
  const validationMessage = el('p', {
    class: 'hint',
    style: 'color:#b42318;min-height:20px;margin:8px 0 0;'
  }, '');

  const col1 = el('div', { style: 'display:flex;flex-direction:column;gap:18px;' });
  const genderSelect = el('select', { onchange: e => state.user.gender = e.target.value },
    el('option', { value: '', selected: state.user.gender === '', disabled: true }, 'Selectați o opțiune'),
    el('option', { value: 'female', selected: state.user.gender === 'female' }, 'Feminin'),
    el('option', { value: 'male', selected: state.user.gender === 'male' }, 'Masculin'),
    el('option', { value: 'prefer_not_to_say', selected: state.user.gender === 'prefer_not_to_say' }, 'Prefer să nu spun'),
  );
  col1.append(
    field('ID participant (automat)', el('input', {
      type: 'text',
      value: state.user.participantId,
      readonly: true
    })),
    field('Vârstă (în ani împliniți)', el('input', {
      type: 'number',
      min: 0,
      value: state.user.age,
      placeholder: 'Vârstă',
      oninput: e => state.user.age = e.target.value
    })),
    field('Gen', genderSelect),
  );

  const col2 = el('div', { style: 'display:flex;flex-direction:column;gap:12px;' });
  const glassesSelect = el('select', { onchange: e => state.user.glasses = e.target.value },
    el('option', { value: '', selected: state.user.glasses === '', disabled: true }, 'Selectați o opțiune'),
    el('option', { value: 'glasses', selected: state.user.glasses === 'glasses' }, 'Da, ochelari'),
    el('option', { value: 'contact_lenses', selected: state.user.glasses === 'contact_lenses' }, 'Da, lentile de contact'),
    el('option', { value: 'no', selected: state.user.glasses === 'no' }, 'Nu')
  );
  const practicedSpatialActivitySelect = el('select', { onchange: e => state.user.practicedSpatialActivity = e.target.value },
    el('option', { value: '', selected: state.user.practicedSpatialActivity === '', disabled: true }, 'Selectați o opțiune'),
    el('option', { value: 'yes', selected: state.user.practicedSpatialActivity === 'yes' }, 'Da'),
    el('option', { value: 'no', selected: state.user.practicedSpatialActivity === 'no' }, 'Nu')
  );
  const visualSpatialComputerUseSelect = el('select', { onchange: e => state.user.visualSpatialComputerUse = e.target.value },
    el('option', { value: '', selected: state.user.visualSpatialComputerUse === '', disabled: true }, 'Selectați o opțiune'),
    el('option', { value: '5_or_less', selected: state.user.visualSpatialComputerUse === '5_or_less' }, '5 ani sau mai puțin'),
    el('option', { value: '6_9', selected: state.user.visualSpatialComputerUse === '6_9' }, '6–9 ani'),
    el('option', { value: '10_or_more', selected: state.user.visualSpatialComputerUse === '10_or_more' }, '10 ani sau mai mult')
  );

  col2.append(
    field('În momentul completării testului, purtați ochelari sau lentile de contact?', glassesSelect),
    field(el('span', {},
      'Ați practicat în mod regulat, (pentru o perioadă de minimum 6 luni și cel puțin de două ori pe săptămână), o activitate care presupune frecvent orientarea corpului și a propriei poziții în raport cu persoane sau repere din spațiu?',
      el('br'),
      'De exemplu: fotbal, baschet, handbal, volei, tenis, dans, arte marțiale, orientare turistică sau navigație'
    ), practicedSpatialActivitySelect),
    field(el('span', {},
      'De câți ani utilizați în mod regulat computerul sau laptopul pentru activități cu componentă vizual-spațială?',
      el('br'),
      'De exemplu: jocuri video, utilizarea hărților, navigare în medii virtuale, design digital, simulări sau modelare 3D'
    ), visualSpatialComputerUseSelect)
  );

  form.append(col1, col2);
  card.append(form);
  card.append(validationMessage);

  const actions = el('div', { class: 'actions' });
  actions.append(
    el('button', {
      class: 'primary',
      onclick: () => {
        const requiredFields = [
          state.user.age,
          state.user.gender,
          state.user.glasses,
          state.user.practicedSpatialActivity,
          state.user.visualSpatialComputerUse
        ];
        const hasEmptyField = requiredFields.some(value => String(value ?? '').trim() === '');
        if (hasEmptyField) {
          validationMessage.textContent = 'Completați toate câmpurile înainte de a continua.';
          validationMessage.style.display = 'block';
          return;
        }
        validationMessage.style.display = 'none';
        state.page = SKIP_CALIBRATION ? 'desc' : 'calibInfo';
        render();
      }
    }, 'Continuați')
  );
  card.append(actions);
  app.append(card);
}

function renderDescription() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(el('h1', {}, 'Exemplu de sarcină'));

  const grid = el('div', { class: 'grid4' });
  const example = state.tests[0];

  const lt = el('div', { class: 'cell' });
  lt.append(el('img', { src: DESCRIPTION_PAGE.imageSrc || placeholderBanner(), alt: 'Imagine descriere' }));

  const rt = el('div', { class: 'cell' });
  const canvasWrap = el('div', { class: 'canvas-wrap' });
  const canvas = el('canvas', { class: 'circle-canvas' });
  canvasWrap.append(canvas);
  rt.append(canvasWrap);

  const lb = el('div', { class: 'cell', style: 'display:flex;flex-direction:column;' });
  const descStyle = 'font-size:16px;line-height:1.5;margin:0;';
  const exampleInstruction = el('p', { style: descStyle },
    'Veți primi o instrucțiune de tipul:',
    el('br'),
    '„Imaginați-vă că stați la ',
    el('strong', {}, example.text1),
    ' și sunteți cu fața spre ',
    el('strong', {}, example.text2),
    '. Indicați unde este ',
    el('strong', {}, example.text3),
    '.”'
  );
  lb.append(
    el('h3', {}, 'Instrucțiuni'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px;' },
      (() => {
        const p = el('p', { style: `${descStyle};white-space:pre-line;` });
        p.textContent = DESCRIPTION_PAGE.text;
        return p;
      })(),
      exampleInstruction
    )
  );

  const rb = el('div', { class: 'cell', style: 'display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;' });
  rb.append(
    el('div', { class: 'actions', style: 'margin-top:0;' },
      el('button', {
        class: 'primary',
        onclick: () => {
          state.page = 'practiceInfo';
          state.currentTestIndex = 0;
          render();
        }
      }, 'Continuați')
    )
  );

  grid.append(lt, rt, lb, rb);
  card.append(grid);
  app.append(card);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  if (example && example.userAngleDeg == null && example.expectedAngle != null) {
    example.userAngleDeg = example.expectedAngle;
  }
  drawCircle(canvas, 0);
}

function renderPracticeInfo() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(
    el('h1', {}, 'Acomodare cu sarcina de orientare spațială'),
    el('p', {},
      'Vor urma ',
      el('strong', {}, '3 sarcini'),
      ' de acomodare cu testul.'
    ),
    el('p', {}, 'În etapa de acomodare, după marcarea răspunsului, veți primi feedback prin intermediul unei linii care arată poziția corectă conform aranjamentului.'),
    el('div', { class: 'actions' },
      el('button', {
        class: 'primary',
        onclick: () => {
          state.tests[0].userAngleDeg = null;
          state.page = 'test';
          state.currentTestIndex = 0;
          render();
        }
      }, 'Începe acomodarea')
    )
  );
  app.append(card);
}

function renderPracticeDone() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(
    el('h1', {}, 'Sarcini de orientare spațială pentru măsurare'),
    el('p', {}, 'Ați indeplinit cu succes sarcinile de acomodare.'),
    el('p', {},
      'Vor urma ',
      el('strong', {}, '12 sarcini'),
      ' de orientare spațială pentru măsurare.'
    ),
    el('div', { class: 'actions' },
      el('button', {
        class: 'primary',
        onclick: () => {
          state.page = 'test';
          state.currentTestIndex = 3;
          render();
        }
      }, 'Continuați')
    )
  );
  app.append(card);
}

function renderCalibrationInfo() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(
    el('h1', {}, 'Instrucțiuni calibrare'),
    el('p', {}, 'În etapa de calibrare vor apărea puncte pe ecran. Priviți fiecare punct și apasați pe el.'),
    el('p', {}, 'Încearcați să mențineți capul stabil, cu fața spre ecran, și să priviți fix fiecare punct înainte de a face click.'),
    el('p', {}, 'Vă rugăm nu vă grăbiți.'),
    el('div', { class: 'actions' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen().catch(() => {});
          }
          state.page = 'calibration';
          render();
        }
      }, 'Începe calibrarea')
    )
  );
  app.append(card);
}

function renderCalibration() {
  app.innerHTML = '';
  setWebGazerPredictionPoints(false);
  const card = el('div', { class: 'card' });

  const wrap = el('div', {
    style: 'position:relative;width:100%;height:100%;overflow:hidden;'
  });

  const controls = el('div', {
    style: `
      position:absolute;right:12px;bottom:12px;z-index:10;
      display:flex;gap:12px;align-items:center;
    `
  });

  const calStatus = el('div', {
    class: 'hint',
    style: 'background:rgba(255,255,255,.92);border:1px solid #ddd;border-radius:8px;padding:6px 10px;max-width:440px;'
  }, '');
  const startBtn = el('button', { class: 'primary', disabled: true }, 'Calibrare...');
  controls.append(calStatus, startBtn);

  const area = el('div', {
    id: 'calFull',
    style: 'position:absolute;inset:0;'
  });

  wrap.append(area, controls);
  card.append(wrap);
  app.append(card);

  startWebGazer(calStatus).then(() => {
    const trainingTargets = shuffle(CAL_TARGETS.map((t, i) => ({ ...t, _id: i })));
    const validationTargets = shuffle(CAL_VALIDATION_TARGETS.map((t, i) => ({ ...t, _id: i })));
    let phase = 'training'; // 'training' | 'validation' | 'passed' | 'failed'
    let trainingIdx = 0;
    let validationIdx = 0;
    let clicksOnTarget = 0;
    const validationErrors = [];
    let validationPassed = false;
    let gazeNearSince = null;
    let dwellMs = 0;
    let dwellReady = false;
    let pollHandle = null;

    const currentTarget = () => {
      if (phase === 'training') return trainingTargets[trainingIdx] || null;
      if (phase === 'validation') return validationTargets[validationIdx] || null;
      return null;
    };

    const targetScreenPoint = (t) => {
      const r = area.getBoundingClientRect();
      return {
        x: r.left + (t.px / 100) * r.width,
        y: r.top + (t.py / 100) * r.height
      };
    };

    const resetDwell = () => {
      gazeNearSince = null;
      dwellMs = 0;
      dwellReady = false;
    };
    const setCalStatus = (msg) => { calStatus.textContent = msg || ''; };

    const updateProgress = () => {
      if (phase === 'training') {
        startBtn.disabled = true;
        startBtn.textContent = 'Calibrare...';
        setCalStatus('Calibrare în curs...');
        return;
      }
      if (phase === 'validation') {
        startBtn.disabled = true;
        startBtn.textContent = 'Verificare...';
        setCalStatus('Verificare calibrare...');
        return;
      }
      if (phase === 'passed') {
        startBtn.disabled = false;
        startBtn.textContent = 'Continuați';
        setCalStatus('Calibrare reușită. Poți trece la etapa de acomodare.');
        return;
      }
      if (phase === 'failed') {
        startBtn.disabled = false;
        startBtn.textContent = 'Repetă calibrarea';
        setCalStatus('Calibrare insuficientă. Reîncearcă.');
      }
    };

    const renderDot = () => {
      area.innerHTML = '';
      const t = currentTarget();
      if (!t) return;

      area.append(el('div', {
        role: 'button',
        tabindex: '0',
        class: phase === 'validation' ? 'cal-dot cal-dot-validation' : (dwellReady ? 'cal-dot cal-dot-ready' : 'cal-dot'),
        style: `
          position:absolute;left:${t.px}%;top:${t.py}%;
          transform:translate(-50%,-50%);
          width:${CAL_DOT_SIZE_PX}px;height:${CAL_DOT_SIZE_PX}px;
          padding:0;margin:0;box-sizing:border-box;
          border-radius:50%;
          border:2px solid ${phase === 'validation' ? '#b91c1c' : (dwellReady ? '#991b1b' : '#dc2626')};
          background:${phase === 'validation' ? '#fca5a5' : (dwellReady ? '#ef4444' : '#f87171')};
          box-shadow:0 0 0 ${dwellReady ? 8 : 5}px ${phase === 'validation' ? 'rgba(220,38,38,.24)' : (dwellReady ? 'rgba(185,28,28,.28)' : 'rgba(239,68,68,.22)')};
        `,
        onclick: () => {
          const active = currentTarget();
          if (!active) return;
          if (phase === 'training') {
            if (CAL_DWELL_MIN_MS > 0 && !dwellReady) return;

            clicksOnTarget++;
            if (window.webgazer?.recordScreenPosition) {
              const p = targetScreenPoint(active);
              try {
                webgazer.recordScreenPosition(p.x, p.y, 'click');
              } catch (e) {
                try { webgazer.recordScreenPosition(p.x, p.y); } catch (_) {}
              }
            }

            if (clicksOnTarget >= CAL_REQUIRED_CLICKS) {
              trainingIdx++;
              clicksOnTarget = 0;
            }

            if (trainingIdx >= trainingTargets.length) {
              phase = 'validation';
              setCalStatus('Calibrarea s-a încheiat. Urmează verificarea scurtă.');
            }
          } else if (phase === 'validation') {
            const p = targetScreenPoint(active);
            const x = state.gaze.lastX;
            const y = state.gaze.lastY;
            const fresh = state.gaze.lastPerfNowMs != null && (performance.now() - state.gaze.lastPerfNowMs) <= 300;
            if (x == null || y == null || !fresh) {
              setCalStatus('Nu există date de privire. Privește punctul și încearcă din nou.');
              return;
            }
            const errPx = Math.hypot(x - p.x, y - p.y);
            validationErrors.push(errPx);
            validationIdx++;

            if (validationIdx >= validationTargets.length) {
              const avgErr = validationErrors.reduce((a, b) => a + b, 0) / validationErrors.length;
              const maxErr = Math.max(...validationErrors);
              validationPassed = avgErr <= CAL_VALIDATION_PASS_AVG_PX;
              phase = validationPassed ? 'passed' : 'failed';
              if (validationPassed) {
                setCalStatus(`Verificare OK. Eroare medie ${Math.round(avgErr)} px (max ${Math.round(maxErr)} px).`);
              } else {
                setCalStatus(`Verificare slabă. Eroare medie ${Math.round(avgErr)} px (prag ${CAL_VALIDATION_PASS_AVG_PX} px).`);
              }
            }
          }

          resetDwell();
          updateProgress();
          renderDot();
          if ((phase === 'passed' || phase === 'failed') && pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
          }
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.currentTarget.click();
          }
        }
      }, ''));
    };

    if (CAL_DWELL_MIN_MS > 0) pollHandle = setInterval(() => {
      const t = currentTarget();
      if (!t) return;

      const x = state.gaze.lastX;
      const y = state.gaze.lastY;
      const now = performance.now();

      if (x == null || y == null || state.gaze.lastPerfNowMs == null || (now - state.gaze.lastPerfNowMs) > 250) {
        resetDwell();
        updateProgress();
        renderDot();
        return;
      }

      const p = targetScreenPoint(t);
      const dx = x - p.x;
      const dy = y - p.y;
      const near = (dx * dx + dy * dy) <= (CAL_GAZE_TOLERANCE_PX * CAL_GAZE_TOLERANCE_PX);

      if (near) {
        if (gazeNearSince == null) gazeNearSince = now;
        dwellMs = Math.max(0, Math.round(now - gazeNearSince));
      } else {
        resetDwell();
      }

      dwellReady = dwellMs >= CAL_DWELL_MIN_MS;
      updateProgress();
      renderDot();
    }, 80);

    updateProgress();
    renderDot();

    startBtn.onclick = () => {
      if (phase === 'passed' && validationPassed) {
        if (pollHandle) clearInterval(pollHandle);
        setWebGazerPredictionPoints(false);
        state.page = 'desc';
        render();
      } else if (phase === 'failed') {
        renderCalibration();
      }
    };
  }).catch(err => {
    calStatus.textContent = `WebGazer a eșuat: ${err?.message || String(err)}`;
    startBtn.disabled = true;
    startBtn.textContent = 'Calibrare indisponibilă';
  });
}
function renderTest(i) {
  const t = state.tests[i];
  app.innerHTML = '';
  const card = el('div', { class: 'card' });

  const grid = el('div', { class: 'grid4' });

  // Left-Top: picture
  const lt = el('div', { class: 'cell', id: 'aoiLT' });
  let imageSrc = TEST_IMAGE;
  lt.append(el('img', { src: imageSrc || placeholderImage(t.index), alt: `Image for ${t.index}` }));

// Left-Bottom: instructions
const lb = el('div', { class: 'cell', id: 'aoiLB', style: 'display:flex;flex-direction:column;' });
lb.append(el('h3', {}, 'Instrucțiuni'));

const sentence = el(
  'p',
  { style: 'margin-top:auto;margin-bottom:0;font-size:18px;line-height:1.6;' },
  'Imaginează-ți că stai pe locul ',
  el('strong', {}, t.text1),
  ', și stai cu fața spre ',
  el('strong', {}, t.text2),
  '. Marchează unde este ',
  el('strong', {}, t.text3),
  '.'
);

lb.append(sentence);




  // Right-Top: interactive circle
  const rt = el('div', { class: 'cell', id: 'aoiRT' });
  const canvasWrap = el('div', { class: 'canvas-wrap' });
  const canvas = el('canvas', { class: 'circle-canvas' });
  canvasWrap.append(canvas);
  rt.append(canvasWrap);

  // Right-Bottom: controls
  const rb = el('div', { class: 'cell', id: 'aoiRB' });
  const testProgress = i >= 3
    ? el('p', { style: 'margin:0 0 8px;font-weight:600;' }, `${i - 2} din 12`)
    : el('p', { style: 'margin:0 0 8px;min-height:24px;' }, '');
  const validationMessage = el('p', {
    class: 'hint',
    style: 'color:#b42318;min-height:20px;margin:8px 0 0;'
  }, '');

  const badge = t.userAngleDeg != null
    ? el('span', { class: 'pill' }, ''/*statusText(t)*/)
    : el('span', { class: 'hint' }, '');

  rb.append(testProgress);
  rb.append(badge);
  rb.append(validationMessage);

  const actions = el('div', { class: 'actions' });
  actions.append(
/*     el('button', {
      onclick: () => {
        // stop trial tracking before leaving
        finalizeTrialAOIs(i);
        if (i > 0) {
          state.currentTestIndex--;
          renderTest(state.currentTestIndex);
        } else {
          state.page = 'calibration';
          renderCalibration();
        }
      }
    }, 'Back'), */
    el('button', {
      class: 'primary',
      onclick: () => {
        if (t.userAngleDeg == null) {
          validationMessage.textContent = 'Marcați poziția pe cerc înainte de a continua.';
          return;
        }
        validationMessage.textContent = '';
        // compute task metrics
        t.submittedPerfMs = performance.now();
        t.responseTimeMs = (t.startPerfMs != null) ? Math.round(t.submittedPerfMs - t.startPerfMs) : null;
        t.diffDeg = t.expectedAngle != null ? angleDiff(t.userAngleDeg, t.expectedAngle) : null;

        // finalize AOI metrics for this trial
        finalizeTrialAOIs(i);

        if (i === 2) {
          state.page = 'practiceDone';
          render();
        } else if (i < state.tests.length - 1) {
          state.currentTestIndex++;
          renderTest(state.currentTestIndex);
        } else {
          finishAndShowSummary();
        }
      }
    }, 'Următorul')
  );
  rb.append(actions);

  grid.append(lt, rt, lb, rb);
  card.append(grid);
  app.append(card);

  // init task timing
  t.startPerfMs = performance.now();

  // setup AOIs now that DOM exists
  measureAOIs();

  // initialize per-trial AOI runtime trackers
  initTrialAOIRuntime(i);

  // Initialize circle canvas interactions
  setupCircleCanvas(canvas, i);
  drawCircle(canvas, i);
}

/**********************
 * Summary            *
 **********************/
function renderSummary() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  const trials = state.tests.slice(-12);
  const angularErrors = trials
    .map(t => Number(t.diffDeg))
    .filter(v => Number.isFinite(v));
  const angularErrorMean = angularErrors.length
    ? angularErrors.reduce((sum, value) => sum + value, 0) / angularErrors.length
    : null;
  const orientationLevel = classifyOrientationLevel(angularErrorMean);
  card.append(
    el('h1', {}, 'Vă mulțumim pentru participare!'),
    el('p', { class: 'hint' }, 'Mai jos este afișată media erorii unghiulare pentru cele 12 sarcini de test.')
  );
  card.append(
    el('p', { style: 'margin:8px 0 0;font-weight:600;' },
      angularErrorMean != null
        ? `Media erorii unghiulare: ${formatAngle(angularErrorMean)}°`
        : 'Media erorii unghiulare: —'
    )
  );
  card.append(
    el('p', { style: 'margin:10px 0 0;font-weight:600;' },
      angularErrorMean != null
        ? `Nivel orientativ al orientării spațiale: ${orientationLevel}`
        : 'Nivel orientativ al orientării spațiale: —'
    )
  );
  card.append(
    el('p', { class: 'hint', style: 'margin:12px 0 0;max-width:820px;line-height:1.5;' },
      'Acest nivel este ',
      el('strong', {}, 'orientativ'),
      ' și este bazat pe ',
      el('strong', {}, 'intervale orientative bazate pe literatura de specialitate'),
      ', nu pe rezultatele sau distribuțiile studiului în curs.'
    )
  );
  card.append(
    el('p', { class: 'hint', style: 'margin:8px 0 0;max-width:820px;line-height:1.5;' },
      'Intervale orientative: ≤ 25° = bun; 25–35° = mediu-bun; 35–50° = mediu; 50–70° = mediu-slab; > 70° = slab.'
    )
  );

  app.append(card);
}

function classifyOrientationLevel(meanAngularError) {
  if (!Number.isFinite(meanAngularError)) return '—';
  if (meanAngularError <= 25) return 'bun';
  if (meanAngularError <= 35) return 'mediu-bun';
  if (meanAngularError <= 50) return 'mediu';
  if (meanAngularError <= 70) return 'mediu-slab';
  return 'slab';
}

async function finishAndShowSummary() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.append(
    el('h1', {}, 'Se salvează datele'),
    el('p', { class: 'hint' }, 'Vă rugăm așteptați puțin. Datele sunt în proces de salvare.')
  );
  app.append(card);

  try {
    await submitSOTDataToGoogleSheets();
    state.summarySaveStatus = 'Datele au fost salvate.';
  } catch (err) {
    state.summarySaveStatus = `Trimiterea automată a eșuat: ${err?.message || String(err)}`;
  }

  state.page = 'summary';
  renderSummary();
}

/************************
 * WebGazer Integration *
 ************************/

async function startWebGazer(statusEl) {
  if (!window.webgazer) throw new Error('WebGazer script not loaded.');
  const wg = window.webgazer;

  if (state.gaze.enabled) return; // already running

  // Configure
  // (keeping defaults lightweight; you can tune models later)
  if (typeof wg.setGazeListener !== 'function') {
    throw new Error('WebGazer API mismatch: setGazeListener missing.');
  }

  const gazeListener = (data, timestamp) => {
    // data: {x,y} in screen coords
    if (!data) return;

    // We only log when on calibration or test pages (or you can extend)
    if (state.page !== 'calibration' && state.page !== 'test') return;

    const perfNow = performance.now();
    if (state.gaze.startedAtPerfMs == null) state.gaze.startedAtPerfMs = perfNow;

    const relPerfMs = perfNow - state.gaze.startedAtPerfMs;
    const x = data.x;
    const y = data.y;

    const aoi = (state.page === 'test') ? aoiFromPoint(x, y) : 'NA';

    // store sample
    state.gaze.samples.push({
      pid: state.user.participantId,
      trialIndex: (state.page === 'test') ? state.tests[state.currentTestIndex].index : 'CAL',
      perfMs: Math.round(relPerfMs),
      x: Math.round(x),
      y: Math.round(y),
      aoi,
      page: state.page
    });

    // heatmap bins (global screen space)
    const bin = DEFAULTS.heatmapBinPx;
    const bx = Math.floor(x / bin);
    const by = Math.floor(y / bin);
    const key = `${bx}_${by}`;
    state.gaze.heatBins.set(key, (state.gaze.heatBins.get(key) || 0) + 1);

    // stream into AOI runtime trackers (test only)
    if (state.page === 'test') {
      updateTrialAOIFromSample(state.currentTestIndex, relPerfMs, x, y, aoi);
    }
    state.gaze.lastX = x;
    state.gaze.lastY = y;
    state.gaze.lastPerfNowMs = perfNow;
    state.gaze.lastSamplePerfMs = relPerfMs;
  };

  // show webcam preview UI? (WebGazer has built-in video feedback)
  statusEl && (statusEl.textContent = 'Requesting camera permission...');

  if (typeof wg.begin !== 'function') {
    throw new Error('WebGazer API mismatch: begin missing.');
  }

  // Defensive setup: avoid stale persisted model state and pick explicit defaults.
  try {
    if (typeof wg.saveDataAcrossSessions === 'function') {
      wg.saveDataAcrossSessions(false);
    }
    if (typeof wg.clearData === 'function') {
      wg.clearData();
    }
    if (typeof wg.setRegression === 'function') {
      wg.setRegression('ridge');
    }
    if (typeof wg.setTracker === 'function') {
      try {
        wg.setTracker('TFFacemesh');
      } catch (_) {
        wg.setTracker('clmtrackr');
      }
    }
  } catch (err) {
    console.warn('webgazer pre-begin setup warning:', err);
  }

  try {
    const beginResult = wg.begin();
    if (beginResult && typeof beginResult.then === 'function') {
      await beginResult;
    }
  } catch (err) {
    throw new Error(`webgazer.begin failed: ${err?.message || String(err)}`);
  }

  try {
    wg.setGazeListener(gazeListener);
  } catch (err) {
    throw new Error(`webgazer.setGazeListener failed: ${err?.message || String(err)}`);
  }

  // Optional UI toggles; never fail startup for these.
  try {
    if (typeof wg.showVideo === 'function') wg.showVideo(false);
    else if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(false);
  } catch (err) {
    console.warn('webgazer video toggle failed:', err);
  }

  try {
    if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(false);
  } catch (err) {
    console.warn('webgazer prediction points toggle failed:', err);
  }

  state.gaze.enabled = true;
  statusEl && (statusEl.textContent = 'Camera enabled. WebGazer running.');
}

// Map a screen point to AOI based on current grid cells
function aoiFromPoint(screenX, screenY) {
  const r = state.currentAOIRects;
  if (!r) return 'NA';
  // DOMRect coords are viewport-relative; screenX/Y from WebGazer are also viewport-relative in practice.
  // If your environment differs, we can adjust with scroll offsets.
  for (const [key, rect] of Object.entries(r)) {
    if (!rect) continue;
    if (screenX >= rect.left && screenX <= rect.right && screenY >= rect.top && screenY <= rect.bottom) {
      return key; // 'LT'|'RT'|'LB'|'RB'
    }
  }
  return 'OUT';
}

// measure AOI rects from DOM
function measureAOIs() {
  const lt = document.getElementById('aoiLT');
  const rt = document.getElementById('aoiRT');
  const lb = document.getElementById('aoiLB');
  const rb = document.getElementById('aoiRB');
  if (!lt || !rt || !lb || !rb) return;

  state.currentAOIRects = {
    LT: lt.getBoundingClientRect(),
    RT: rt.getBoundingClientRect(),
    LB: lb.getBoundingClientRect(),
    RB: rb.getBoundingClientRect(),
  };
}

// Re-measure AOIs on resize/scroll (important for accuracy)
window.addEventListener('resize', () => { if (state.page === 'test') measureAOIs(); });
window.addEventListener('scroll', () => { if (state.page === 'test') measureAOIs(); }, { passive: true });

/*********************************
 * AOI / Fixation metric runtime *
 *********************************/

// per trial init
function initTrialAOIRuntime(trialIdx) {
  const t = state.tests[trialIdx];
  t._aoiRuntime = {
    // dwell accumulator per AOI
    dwellMs: { LT: 0, RT: 0, LB: 0, RB: 0 },
    // fixation durations list per AOI
    fixationDurations: { LT: [], RT: [], LB: [], RB: [] },
    // fixations count per AOI
    fixationCount: { LT: 0, RT: 0, LB: 0, RB: 0 },

    // current segment tracking
    currentAOI: null,
    segStartMs: null,
    lastMs: null,
  };

  // initialize aoiStats output container
  t.aoiStats = {
    LT: blankAOIStats(),
    RT: blankAOIStats(),
    LB: blankAOIStats(),
    RB: blankAOIStats(),
  };
}

function blankAOIStats() {
  return {
    dwellTimeMs: 0,
    fixationCount: 0,
    meanFixationDurationMs: 0
  };
}

// stream samples to dwell/fixation logic
function updateTrialAOIFromSample(trialIdx, relMs, x, y, aoi) {
  const t = state.tests[trialIdx];
  const rt = t._aoiRuntime;
  if (!rt) return;

  const minFix = Number(state.user.fixationMinMs || DEFAULTS.fixationMinMs);
  const gapMax = DEFAULTS.segmentGapMaxMs;

  // dwell: accumulate time deltas inside AOI
  if (rt.lastMs != null) {
    const dt = relMs - rt.lastMs;

    // if huge gap, finalize current segment and reset
    if (dt > gapMax) {
      closeSegment(t);
      rt.currentAOI = null;
      rt.segStartMs = null;
      rt.lastMs = relMs;
      return;
    }

    // add dwell for previous AOI if it was one of our 4 AOIs
    if (rt.currentAOI && ['LT', 'RT', 'LB', 'RB'].includes(rt.currentAOI)) {
      rt.dwellMs[rt.currentAOI] += dt;
    }
  }

  // segment logic: a fixation candidate is "staying in same AOI"
  if (rt.currentAOI == null) {
    rt.currentAOI = aoi;
    rt.segStartMs = relMs;
  } else if (aoi !== rt.currentAOI) {
    // leaving AOI => close segment
    closeSegment(t);
    rt.currentAOI = aoi;
    rt.segStartMs = relMs;
  }

  rt.lastMs = relMs;

  function closeSegment(testObj) {
    const rtx = testObj._aoiRuntime;
    if (!rtx || rtx.currentAOI == null || rtx.segStartMs == null || rtx.lastMs == null) return;

    const dur = rtx.lastMs - rtx.segStartMs;
    const segAOI = rtx.currentAOI;

    if (['LT', 'RT', 'LB', 'RB'].includes(segAOI) && dur >= minFix) {
      rtx.fixationCount[segAOI] += 1;
      rtx.fixationDurations[segAOI].push(Math.round(dur));
    }
  }
}

// finalize metrics for trial (close any open segment + compute means)
function finalizeTrialAOIs(trialIdx) {
  const t = state.tests[trialIdx];
  const rt = t._aoiRuntime;
  if (!rt) return;

  // close final segment
  if (rt.currentAOI != null && rt.segStartMs != null && rt.lastMs != null) {
    const dur = rt.lastMs - rt.segStartMs;
    const segAOI = rt.currentAOI;
    const minFix = Number(state.user.fixationMinMs || DEFAULTS.fixationMinMs);
    if (['LT', 'RT', 'LB', 'RB'].includes(segAOI) && dur >= minFix) {
      rt.fixationCount[segAOI] += 1;
      rt.fixationDurations[segAOI].push(Math.round(dur));
    }
  }

  // compute per-AOI summary
  for (const aoi of ['LT', 'RT', 'LB', 'RB']) {
    const dwell = Math.round(rt.dwellMs[aoi] || 0);
    const count = rt.fixationCount[aoi] || 0;
    const durs = rt.fixationDurations[aoi] || [];
    const mean = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;

    t.aoiStats[aoi] = {
      dwellTimeMs: dwell,
      fixationCount: count,
      meanFixationDurationMs: mean
    };
  }

  // keep runtime (for export of fixation events), but prevent double-finalize by marking
  // (safe if user navigates back/next repeatedly)
  t._aoiRuntimeFinalized = true;
}

/************************
 * Circle / Canvas code *
 ************************/

function setupCircleCanvas(canvas, testIndex) {
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    drawCircle(canvas, testIndex);
  };
  resize();
  window.addEventListener('resize', resize);

  let dragging = false;

  const setAngleFromEvent = (evt) => {
    const pos = pointerPos(canvas, evt);
    const { cx, cy, r } = circleGeom(canvas);
    const dx = pos.x - cx, dy = pos.y - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > r * 1.2) return;

    const rad = Math.atan2(dx, -dy);
    let deg = rad * 180 / Math.PI;
    if (deg < 0) deg += 360;

    state.tests[testIndex].userAngleDeg = deg;
    drawCircle(canvas, testIndex);
  };

  canvas.addEventListener('mousedown', e => { setAngleFromEvent(e); dragging = true; });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('mousemove', e => { if (dragging) setAngleFromEvent(e); });

  canvas.addEventListener('touchstart', e => {
    setAngleFromEvent(e.touches[0]); dragging = true; e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (dragging) setAngleFromEvent(e.touches[0]); e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', () => { dragging = false; });
}

function drawCircle(canvas, testIndex) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  const { cx, cy, r } = circleGeom(canvas);
  const t = state.tests[testIndex];

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();

  drawArrow(ctx, cx, cy, cx, cy - r * 0.95, { color: '#999' });

  ctx.fillStyle = '#333';
  ctx.font = `${Math.max(12, Math.floor(r * 0.12))}px sans-serif`;
  if (t.text4) ctx.fillText(t.text4, cx + 6, cy - 6);
  if (t.text5) ctx.fillText(t.text5, cx + 6, cy - r + 18);

  const showExpected = (t.controlLineDraw === 'Before') ||
                       (t.controlLineDraw === 'After' && t.userAngleDeg != null);
  if (showExpected && t.expectedAngle != null) {
    drawAngleLine(ctx, cx, cy, r, t.expectedAngle, { color: '#d7263d', width: 3 });
    ctx.fillStyle = '#d7263d';
    ctx.font = `${Math.max(12, Math.floor(r * 0.14))}px sans-serif`;
    /*ctx.fillText(`Expected ${formatAngle(t.expectedAngle)}°`, 10, 24);*/
  }

  if (t.userAngleDeg != null) {
    drawAngleLine(ctx, cx, cy, r, t.userAngleDeg, { color: '#0b5fff', width: 3, showHandle: true });
    ctx.fillStyle = '#0b5fff';
    ctx.font = `${Math.max(12, Math.floor(r * 0.14))}px sans-serif`;
    /*ctx.fillText(`User ${formatAngle(t.userAngleDeg)}°`, cx + 10, cy + 24);*/
  }

  ctx.save();
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.stroke();
  ctx.restore();
}

function circleGeom(canvas) {
  const W = canvas.width, H = canvas.height;
  const r = Math.floor(Math.min(W, H) * 0.38);
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  return { cx, cy, r };
}

function drawAngleLine(ctx, cx, cy, r, angleDeg, { color = '#0b5fff', width = 3, showHandle = false } = {}) {
  const rad = angleDeg * Math.PI / 180;
  const ux = Math.sin(rad), uy = -Math.cos(rad);
  const ex = cx + ux * r, ey = cy + uy * r;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  if (showHandle) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(6, Math.floor(r * 0.04)), 0, 2 * Math.PI);
    ctx.fill();
  }
}

function drawArrow(ctx, x1, y1, x2, y2, { color = '#333', headLen = 12 } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**********************
 * Utilities          *
 **********************/
function pointerPos(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const clientX = ('clientX' in evt) ? evt.clientX : 0;
  const clientY = ('clientY' in evt) ? evt.clientY : 0;
  return {
    x: (clientX - rect.left) * dpr,
    y: (clientY - rect.top) * dpr
  };
}

function formatAngle(a) {
  let x = a % 360;
  if (x < 0) x += 360;
  return Math.round(x * 10) / 10;
}

function angleDiff(a, b) {
  if (a == null || b == null) return null;
  let d = ((a - b) % 360 + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function statusText(t) {
  const u = t.userAngleDeg != null ? formatAngle(t.userAngleDeg) : '—';
  const e = t.expectedAngle != null ? formatAngle(t.expectedAngle) : '—';
  const diff = (t.expectedAngle != null && t.userAngleDeg != null) ? `${formatAngle(angleDiff(t.userAngleDeg, t.expectedAngle))}°` : '—';
  return `Utilizator: ${u}°, Așteptat: ${e}°, Δ: ${diff}`;
}


/**********************
 * CSV export         *
 **********************/

function exportSOTCSVs() {
  const { sotHeader, sotRow } = buildSOTDataRow();
  downloadCSV('SOTData.csv', [sotHeader, sotRow]);
}

function buildSOTDataRow() {
  const pid = state.user.participantId;

  // last 12 executed tests only
  const trials = state.tests.slice(-12);

  const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
  const mean = (arr) => arr.length ? sum(arr) / arr.length : null;
  const sd = (arr) => {
    if (arr.length < 2) return null;
    const m = mean(arr);
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(v);
  };

  // Angular error stats (last 12)
  const angErrors = trials.map(t => Number(t.diffDeg)).filter(v => Number.isFinite(v));
  const angularErrorMean = mean(angErrors);
  const angularErrorSD = sd(angErrors);

  // Response time sum (last 12)
  const responseTimeSum = sum(trials.map(t => t.responseTimeMs));

  // AOI sums (last 12)
  const AOIS = ['LT', 'RT', 'LB', 'RB'];
  const fixDurSum = {};
  const fixCountSum = {};
  const dwellSum = {};

  for (const aoi of AOIS) {
    fixDurSum[aoi] = sum(trials.flatMap(t => t._aoiRuntime?.fixationDurations?.[aoi]));
    fixCountSum[aoi] = sum(trials.map(t => t.aoiStats?.[aoi]?.fixationCount));
    dwellSum[aoi]    = sum(trials.map(t => t.aoiStats?.[aoi]?.dwellTimeMs));
  }

  // 1) SOTData.csv (one line per participant)
  const sotHeader = [
    'participantId','age','gender','glasses','practicedSpatialActivity','visualSpatialComputerUse','fixationMinMs',
    'angularErrorMean','angularErrorSD','responseTimeSum',
    'fixDurSum_LT','fixDurSum_RT','fixDurSum_LB','fixDurSum_RB',
    'fixCountSum_LT','fixCountSum_RT','fixCountSum_LB','fixCountSum_RB',
    'dwellSum_LT','dwellSum_RT','dwellSum_LB','dwellSum_RB'
  ];

  const sotRow = [
    pid, state.user.age, state.user.gender, state.user.glasses, state.user.practicedSpatialActivity, state.user.visualSpatialComputerUse, state.user.fixationMinMs,
    angularErrorMean, angularErrorSD, responseTimeSum,
    fixDurSum.LT, fixDurSum.RT, fixDurSum.LB, fixDurSum.RB,
    fixCountSum.LT, fixCountSum.RT, fixCountSum.LB, fixCountSum.RB,
    dwellSum.LT, dwellSum.RT, dwellSum.LB, dwellSum.RB
  ];
  return { sotHeader, sotRow };
}

async function submitSOTDataToGoogleSheets() {
  if (!GOOGLE_SHEETS_WEBAPP_URL) {
    throw new Error('Setează GOOGLE_SHEETS_WEBAPP_URL în app.js');
  }
  const { sotHeader, sotRow } = buildSOTDataRow();
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const payload = {
    header: ['timestamp', ...sotHeader],
    row: [timestamp, ...sotRow],
  };
  const body = new URLSearchParams({
    payload: JSON.stringify(payload)
  }).toString();

  try {
    // Form-encoded POST avoids CORS preflight in most browsers.
    const res = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    // Fallback for environments that still block CORS to Apps Script.
    await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
  }
}



function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function csvCell(v) {
  const s = (v == null) ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function makeId() {
  // simple, local-only participant id
  return 'P' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
}

/**********************
 * DOM helper         *
 **********************/
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node[k] = v;
    else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    }
    else if (v != null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}
function field(labelText, inputEl) {
  const wrap = el('div', { class: 'field' });
  const labelEl = el('label', {});
  if (labelText?.nodeType) labelEl.append(labelText);
  else labelEl.append(labelText);
  wrap.append(labelEl, inputEl);
  return wrap;
}

/**********************
 * Placeholders       *
 **********************/
function placeholderImage(n = 1) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
      <defs>
        <linearGradient id="g${n}" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#e0e7ff"/>
          <stop offset="1" stop-color="#eef2ff"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g${n})"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="36" fill="#334">
        Placeholder Image ${n}
      </text>
    </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function placeholderBanner() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="240">
      <defs>
        <linearGradient id="gb" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#f8fafc"/>
          <stop offset="1" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#gb)"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="28" fill="#334">
        Imagine pagină descriere
      </text>
    </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function setupCanvas(id) {
  const c = document.getElementById(id);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const r = c.getBoundingClientRect();
  c.width = Math.floor(r.width * dpr);
  c.height = Math.floor(r.height * dpr);
  return c.getContext('2d');
}

// HEATMAP (from heatBins)
function drawHeatmap(id) {
  const ctx = setupCanvas(id);
  const bin = DEFAULTS.heatmapBinPx;
  let max = 0;
  for (const v of state.gaze.heatBins.values()) max = Math.max(max, v);

  for (const [key, count] of state.gaze.heatBins.entries()) {
    const [bx, by] = key.split('_').map(Number);
    const alpha = max ? count / max : 0;
    ctx.fillStyle = `rgba(255,0,0,${alpha})`;
    ctx.fillRect(bx * bin, by * bin, bin, bin);
  }
}

// SCATTER (raw gaze points)
function drawScatter(id) {
  const ctx = setupCanvas(id);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (const g of state.gaze.samples) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderConsent() {
  app.innerHTML = '';
  const card = el('div', { class: 'card' });

  const chk = el('input', { type: 'checkbox', id: 'consentChk' });

  card.append(
    el('h1', {}, 'Consimțământ informat'),
    el('p', {}, 'Mă numesc Crina-Maria Tölcséres, sunt studentă în anul III la Facultatea de Psihologie a Universității Transilvania din Brașov.'),
    el('p', {}, 'Vă invit să participați la studiul desfășurat pentru realizarea lucrării mele de licență, coordonată de lector dr. Moșoi Adrian Alexandru.'),
    el('p', {}, 'Scopul acestui studiu este analiza relației dintre nivelul de orientare spațială și indicatorii comportamentului vizual.'),
    el('p', {},
      el('strong', {}, 'Important'),
      ': Pentru participare sunt necesare îndeplinirea următoarelor condiții:'
    ),
    el('ul', {},
      el('li', {},
        el('strong', {}, 'laptop sau PC cu cameră web funcțională'),
        ' (vă rog nu completați de pe smartphone);'
      ),
      el('li', {}, 'condiții adecvate de iluminare (fața vizibilă, fără lumină puternică din spate);'),
      el('li', {}, 'poziționarea stabilă în fața ecranului;'),
      el('li', {}, 'vârsta minimă de 18 ani.')
    ),
    el('p', {}, 'Participarea presupune:'),
    el('ul', {},
      el('li', {}, 'completarea unor întrebări demografice simple;'),
      el('li', {}, 'parcurgerea etapei de calibrare și acomodarea cu testul;'),
      el('li', {}, 'rezolvarea a 12 sarcini de orientare spațială.')
    ),
    el('p', {},
      'Durata estimată a participării este de aproximativ ',
      el('strong', {}, '10-15 minute'),
      '.'
    ),
    el('p', {}, 'Participarea dumneavoastră este voluntară și anonimă, iar retragerea este posibilă în orice moment, fără consecințe.'),
    el('p', {}, 'Nu se înregistrează și nu se stochează imagini video; sunt colectate exclusiv date anonime privind comportamentul vizual.'),
    el('p', {}, 'Informațiile vor fi utilizate numai în scop academic și vor fi analizate la nivel agregat.'),
    el('p', {},
      'Dacă aveți întrebări referitoare la acest studiu, adresa de contact este ',
      el('a', { href: 'mailto:crina.baciu@student.unitbv.ro' }, 'crina.baciu@student.unitbv.ro')
    ),
    el('label', { style: 'display:flex;gap:10px;align-items:flex-start;margin-top:12px;' },
      chk,
      el('span', {}, 'Sunt de acord să particip.')
    ),
    el('div', { class: 'actions' },
      el('button', {
        class: 'primary',
        onclick: () => {
          if (!chk.checked) return alert('Bifați consimțământul pentru a continua.');
          state.page = 'form';
          render();
        }
      }, 'Continuați')
    )
  );

  app.append(card);
}
