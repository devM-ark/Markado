// Print Reports renderer: the SF9 Report Card (laid out exactly like the DepEd Excel templates -- the frames in
// sf9-frames.js are generated from them) and the Grade Slip (the same layout as the student's own view).
// Needs sf9-frames.js loaded first. Everything it makes is scoped under .sf9 / .slip so it can't pick up the app's CSS.

var Sf9 = (function () {
  'use strict';

  var D = window.SF9_DATA;
  var MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
  var CATEGORY_LABELS = { CORE: 'Core Subjects', ELECTIVE: 'Elective Subjects', SPECIAL: 'Special Subjects' };
  var CATEGORY_ORDER = ['CORE', 'ELECTIVE', 'SPECIAL'];
  var REGION_NAMES = {
    'MIMAROPA': 'MIMAROPA Region', 'NCR': 'National Capital Region (NCR)', 'CAR': 'Cordillera Administrative Region (CAR)',
    'BARMM': 'Bangsamoro Autonomous Region (BARMM)', 'NIR': 'Negros Island Region (NIR)',
  };

  // Paper: prints as US Letter by default (what the templates are set up for). The boxes are sized so a page also fits A4
  // if the teacher picks it in the print window (A4 landscape is the shorter one): printable area in CSS px, 96/in.
  var BOX = {
    card: { w: 990, h: 730, page: 'size: letter landscape; margin: 0.3in' },
    slip: { w: 710, h: 970, page: 'size: letter portrait; margin: 0.4in' },
  };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function isSHS(gradeLevel) {
    var n = parseInt(String(gradeLevel === undefined || gradeLevel === null ? '' : gradeLevel).replace(/[^0-9]/g, ''), 10);
    return n === 11 || n === 12;
  }

  function termGrade(subject, n) {
    var hit = (subject.terms || []).filter(function (t) { return Number(t.term) === n; })[0];
    return hit ? String(hit.termGrade) : '';
  }


  // ---------- Report Card ----------

  function regionText(code) {
    if (!code) return '';
    return REGION_NAMES[code] || ('Region ' + code);
  }

  function yearText(label) {
    return label ? 'School Year ' + String(label).replace(/\s*-\s*/, ' - ') : '';
  }

  /** Splits a template row into its opening <tr> and its cells. */
  function splitRow(rowHtml) {
    return { open: rowHtml.slice(0, rowHtml.indexOf('<td')), cells: rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [] };
  }

  /** A copy of a template row with the given cells' text replaced (edits: {cellIndex: text}) and 'na' (grey) cells. */
  function buildRow(rowHtml, edits, naCells, trAttr) {
    var parts = splitRow(rowHtml);
    var cells = parts.cells.map(function (cell, i) {
      var out = cell;
      if (edits && Object.prototype.hasOwnProperty.call(edits, i)) {
        out = out.replace(/>[\s\S]*<\/td>$/, '>' + esc(edits[i]) + '</td>');
      }
      if (naCells && naCells.indexOf(i) !== -1) out = out.replace(/class="([^"]*)"/, 'class="$1 na"');
      return out;
    });
    var open = trAttr ? parts.open.replace('<tr ', '<tr ' + trAttr + ' ') : parts.open;
    return open + cells.join('') + '</tr>';
  }

  /** Replaces the text of every cell that carries a data-f role the values know about; other cells print as the template has them. */
  function fillRoles(html, values) {
    return html.replace(/(<td[^>]*data-f="(\w+)"[^>]*>)([^<]*)(<\/td>)/g, function (m, open, role, old, close) {
      if (!Object.prototype.hasOwnProperty.call(values, role)) return m;
      return open + esc(values[role]) + close;
    });
  }

  function infoValues(learner, cls, school) {
    var days = (school && school.classDays) || {};
    var total = 0, any = false;
    var values = {
      region: regionText(school.region),
      division: school.division ? 'SCHOOLS DIVISION OFFICE OF ' + String(school.division).toUpperCase() : 'SCHOOLS DIVISION OFFICE OF',
      district: school.district ? String(school.district).replace(/\s+district$/i, '') + ' District' : 'District',
      municipality: school.municipality ? 'Municipality of ' + String(school.municipality).replace(/^municipality of\s+/i, '') : 'Municipality of',
      school: String(cls.schoolName || school.schoolName || '').toUpperCase(),
      year: yearText(cls.schoolYearLabel || school.schoolYear),
      name: learner.studentName || '',
      age: '',
      sex: learner.sex === 'M' ? 'Male' : (learner.sex === 'F' ? 'Female' : ''),
      lrn: learner.lrn || '',
      grade: cls.gradeLevel === undefined || cls.gradeLevel === null ? '' : String(cls.gradeLevel),
      section: cls.section || '',
      track: cls.track || '',
      principal: school.principalName || '',
      adviser: cls.adviserName || '',
    };
    MONTHS.forEach(function (m, i) {
      var v = days[m];
      var has = v !== '' && v !== undefined && v !== null && isFinite(Number(v));
      values['cd' + i] = has ? String(Number(v)) : '';
      if (has) { total += Number(v); any = true; }
    });
    values.cdtotal = any ? String(total) : '';
    return values;
  }

  function cardBodyRows(frame, key, learner) {
    var rows = [];
    var shs = key === 'shs';
    var subjectEdits = function (s) {
      var edits = { 1: s.subjectName, 2: termGrade(s, 1), 3: termGrade(s, 2), 4: termGrade(s, 3) };
      var na = [];
      (s.requiredTerms ? [1, 2, 3] : []).forEach(function (n) {
        if (s.requiredTerms.indexOf(n) === -1) na.push(n + 1);
      });
      var final = s.finalGrade === null || s.finalGrade === undefined ? '' : String(s.finalGrade);
      if (shs) { edits[5] = s.units === null || s.units === undefined ? '' : String(s.units); edits[6] = final; edits[7] = s.remark || ''; }
      else { edits[5] = final; edits[6] = s.remark || ''; }
      return { edits: edits, na: na };
    };
    var addSubject = function (s) {
      var e = subjectEdits(s);
      rows.push(buildRow(frame.rows.subject, e.edits, e.na));
      (s.components || []).forEach(function (c) {
        rows.push(buildRow(frame.rows.component, { 1: '       ' + c.subjectName, 2: termGrade(c, 1), 3: termGrade(c, 2), 4: termGrade(c, 3) }));
      });
    };
    if (shs) {
      var groups = { CORE: [], ELECTIVE: [], SPECIAL: [] };
      learner.subjects.forEach(function (s) {
        groups[groups[s.subjectCategory] ? s.subjectCategory : 'ELECTIVE'].push(s); // untagged (older) subjects default to Elective, as on the student view
      });
      CATEGORY_ORDER.forEach(function (cat) {
        if (groups[cat].length === 0) return;
        rows.push(buildRow(frame.rows.category, { 1: CATEGORY_LABELS[cat] }));
        groups[cat].forEach(addSubject);
      });
    } else {
      learner.subjects.forEach(addSubject);
    }
    var ga = learner.generalAverage === null || learner.generalAverage === undefined ? '' : String(learner.generalAverage);
    var gaEdits = shs
      ? { 2: learner.totalUnits ? String(learner.totalUnits) : '', 3: ga, 4: learner.generalRemark || '' }
      : { 2: ga, 3: learner.generalRemark || '' };
    rows.push(buildRow(frame.rows.ga, gaEdits, null, 'data-ga="1"'));
    return rows.join('');
  }

  /** One learner's two-panel report card, at the template's natural size. */
  function cardHtml(learner, cls, school) {
    var key = isSHS(cls.gradeLevel) ? 'shs' : 'k10';
    var frame = D.frames[key];
    var values = infoValues(learner, cls, school);
    var left = fillRoles(frame.leftHead, values) + cardBodyRows(frame, key, learner) + fillRoles(frame.leftTail, values);
    var right = fillRoles(frame.right, values);
    var P = D.place;
    var logo = school.logo
      ? '<img class="sf9-logo" alt="" src="' + school.logo + '" style="left:' + P.logo.x + 'px;top:' + P.logo.y + 'px;width:' + P.logo.w + 'px;height:' + P.logo.h + 'px">'
      : '';
    return '<div class="sf9-card" data-frame="' + key + '" style="width:' + (frame.leftW + frame.gapW + frame.rightW) + 'px">' +
      '<div class="sf9-panel sf9-left" style="width:' + frame.leftW + 'px">' +
        '<table class="sf9t" style="width:' + frame.leftW + 'px">' + frame.leftCols + '<tbody>' + left + '</tbody></table>' +
        '<img class="sf9-seal" alt="" src="' + D.seal + '" style="left:' + P.seal.x + 'px;top:' + P.seal.y + 'px;width:' + P.seal.size + 'px;height:' + P.seal.size + 'px">' + logo +
      '</div>' +
      '<div class="sf9-gap" style="width:' + frame.gapW + 'px"></div>' +
      '<div class="sf9-panel sf9-right" style="width:' + frame.rightW + 'px">' +
        '<table class="sf9t" style="width:' + frame.rightW + 'px">' + frame.rightCols + '<tbody>' + right + '</tbody></table>' +
      '</div></div>';
  }


  // ---------- Grade Slip (the student view's layout) ----------

  function nameHtml(fullName) {
    var parts = String(fullName || '').split(',');
    if (parts.length < 2) return esc(fullName || '');
    var rest = parts.slice(1).join(',').trim();
    return '<b>' + esc(parts[0].trim()) + '</b>' + (rest ? ', ' + esc(rest) : '');
  }

  function infoRow(label, valueHtml, full, extraClass) {
    var cls = [full ? 'full' : '', extraClass || ''].filter(Boolean).join(' ');
    return '<div' + (cls ? ' class="' + cls + '"' : '') + '><span class="info-label">' + esc(label) + ':</span><span class="info-value">' + valueHtml + '</span></div>';
  }

  function remarkClass(remark) {
    if (remark === 'Passed' || remark === 'Promoted') return 'remark pass';
    if (remark === 'Failed' || remark === 'Retained') return 'remark fail';
    return 'remark';
  }

  function gradeCell(value) {
    return value === '' ? '<td class="dash">-</td>' : '<td class="num">' + esc(value) + '</td>';
  }

  function finalCell(value) {
    return value === null || value === undefined ? '<td class="dash final">-</td>' : '<td class="num final">' + esc(value) + '</td>';
  }

  function slipSubjectRows(s) {
    var cells = [1, 2, 3].map(function (n) { return gradeCell(termGrade(s, n)); }).join('');
    var main = '<tr><td class="subj">' + esc(s.subjectName) + '</td>' + cells + finalCell(s.finalGrade) +
      '<td class="desc">' + esc(s.finalDescriptor || '') + '</td><td class="' + remarkClass(s.remark) + '">' + esc(s.remark || '') + '</td></tr>';
    var comps = (s.components || []).map(function (c) {
      var cc = [1, 2, 3].map(function (n) { return gradeCell(termGrade(c, n)); }).join('');
      return '<tr class="component-row"><td class="subj comp-name">' + esc(c.subjectName) + '</td>' + cc + '<td></td><td></td><td></td></tr>';
    }).join('');
    return main + comps;
  }

  function slipHtml(learner, cls, school) {
    var e = {
      schoolName: cls.schoolName, schoolYearLabel: cls.schoolYearLabel, gradeLevel: cls.gradeLevel, section: cls.section,
      track: cls.track, cluster: cls.cluster, adviserName: cls.adviserName,
    };
    var shs = isSHS(e.gradeLevel);
    var info = infoRow('Student Name', nameHtml(learner.studentName)) +
      infoRow('Grade Level', esc(e.gradeLevel || ''), false, 'info-shift-right') +
      infoRow('LRN', esc(learner.lrn || '')) +
      infoRow('Section', esc(e.section || ''), false, 'info-shift-right') +
      (shs ? infoRow('Track', esc(e.track || '')) + infoRow('Cluster', esc(e.cluster || '')) : '') +
      '<div class="info-spacer"></div>' + infoRow('Class Adviser', esc(e.adviserName || ''), true);
    var header = '<div class="report-header">' +
      (e.schoolName ? '<div class="report-school">' + esc(e.schoolName) + '</div>' : '') +
      (e.schoolYearLabel ? '<div class="report-year">School Year ' + esc(e.schoolYearLabel) + '</div>' : '') +
      '<div class="report-title">Learner&rsquo;s Progress Report</div>' +
      '<div class="report-powered">powered by</div><div class="report-brand">MARKADO: Online Grade Viewer</div></div>' +
      '<div class="report-info-grid">' + info + '</div>';

    var rows;
    if (shs) {
      var groups = { CORE: [], ELECTIVE: [], SPECIAL: [] };
      learner.subjects.forEach(function (s) { groups[groups[s.subjectCategory] ? s.subjectCategory : 'ELECTIVE'].push(s); });
      rows = CATEGORY_ORDER.filter(function (c) { return groups[c].length > 0; }).map(function (c) {
        return '<tr class="category-row"><td colspan="7">' + CATEGORY_LABELS[c] + '</td></tr>' + groups[c].map(slipSubjectRows).join('');
      }).join('');
    } else {
      rows = learner.subjects.map(slipSubjectRows).join('');
    }
    rows += '<tr class="general-average-row"><td colspan="4" class="ga-label">General Average</td>' + finalCell(learner.generalAverage) +
      '<td class="desc">' + esc(learner.generalDescriptor || '') + '</td><td class="' + remarkClass(learner.generalRemark) + '">' + esc(learner.generalRemark || '') + '</td></tr>';

    var logo = school && school.logo ? '<img class="slip-logo" alt="" src="' + school.logo + '">' : '';
    return '<div class="slip' + (logo ? ' has-logo' : '') + '">' + logo + header +
      '<table class="grades-table report-table"><colgroup><col><col class="term-col"><col class="term-col"><col class="term-col"><col class="final-col"><col class="desc-col"><col class="remark-col"></colgroup>' +
      '<thead><tr><th rowspan="2">Learning Areas</th><th colspan="3">Term</th><th rowspan="2">Final Grade</th><th rowspan="2">Description</th><th rowspan="2">Remarks</th></tr>' +
      '<tr><th>1</th><th>2</th><th>3</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }


  // ---------- Pages ----------

  /** All the pages for one kind of report ('card' or 'slip') -- one card per page, or two slips per page. */
  function pagesHtml(kind, learners, cls, school, boxOverride) {
    var b = boxOverride || BOX[kind]; // the preview passes its own (smaller) box so only one scaling step is ever applied
    var pages = [];
    if (kind === 'card') {
      learners.forEach(function (l) {
        pages.push('<div class="sf9-page" style="width:' + b.w + 'px;height:' + b.h + 'px"><div class="sf9-pos">' + cardHtml(l, cls, school) + '</div></div>');
      });
    } else {
      for (var i = 0; i < learners.length; i += 2) {
        var cell = function (l) { return '<div class="slip-cell" style="height:' + Math.floor(b.h / 2) + 'px">' + (l ? '<div class="sf9-pos">' + slipHtml(l, cls, school) + '</div>' : '') + '</div>'; };
        pages.push('<div class="slip-page" style="width:' + b.w + 'px;height:' + b.h + 'px">' + cell(learners[i]) + cell(learners[i + 1]) + '</div>');
      }
    }
    return pages.join('');
  }

  function blankRow(key) {
    return buildRow(D.frames[key].rows.subject, { 1: '' }); // the template row's sample subject name must not print
  }

  /**
   * Sizes everything once it is in the DOM (it needs real measurements): pads the learning-area table with blank rows
   * so the two panels end together, then scales each card / slip down if it would overflow its page.
   */
  /** Whether text could run through this cell without crossing a line: only a line at its bottom (this row's underline) or a vertical one gets in the way -- a top border is the row above's underline. */
  function borderless_(el) {
    var c = getComputedStyle(el);
    return ['Right', 'Bottom', 'Left'].every(function (side) {
      return c['border' + side + 'Style'] === 'none' || parseFloat(c['border' + side + 'Width']) === 0;
    });
  }

  /**
   * The template's cell widths were drawn for one particular font. On a computer with a different (wider) font the same
   * words no longer fit: text runs past the page border, or over the line it should sit beside. So any single-line text
   * that is wider than the room it has is made just small enough to fit. The room is its own cell, plus the empty,
   * line-less cells after it that Excel would let it spill into.
   */
  function fitText_(root) {
    var range = document.createRange();
    Array.prototype.forEach.call(root.querySelectorAll('table.sf9t td'), function (td) {
      if (!td.textContent.trim()) return;
      var cs = getComputedStyle(td);
      if (cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'normal') return; // wrapping cells grow downward instead
      var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      var room = td.clientWidth - padX;
      if (cs.textAlign === 'left' || cs.textAlign === 'start') {
        for (var sib = td.nextElementSibling; sib && !sib.textContent.trim() && borderless_(sib); sib = sib.nextElementSibling) room += sib.offsetWidth;
      }
      range.selectNodeContents(td);
      var need = range.getBoundingClientRect().width;
      if (need > room + 0.5) {
        td.style.fontSize = (parseFloat(cs.fontSize) * Math.max(0.55, (room / need) * 0.99)) + 'px';
      }
    });
  }

  var SLIP_LOGO_MAX = 72, SLIP_LOGO_MIN = 40;

  /**
   * The header text is centred on the slip, which leaves an empty strip on its left. The logo goes in the middle of that
   * strip -- measured, so it stays centred whatever the school name's length (and shrinks if a long name leaves little room).
   */
  function placeSlipLogo_(slip) {
    var logo = slip.querySelector('.slip-logo');
    var header = slip.querySelector('.report-header');
    if (!logo || !header) return;
    var range = document.createRange();
    var textLeft = Infinity;
    Array.prototype.forEach.call(header.children, function (line) {
      range.selectNodeContents(line);
      var r = range.getBoundingClientRect();
      if (r.width > 0) textLeft = Math.min(textLeft, r.left);
    });
    if (!isFinite(textLeft)) return;
    var strip = textLeft - slip.getBoundingClientRect().left; // empty width to the left of the header text
    var size = Math.max(SLIP_LOGO_MIN, Math.min(SLIP_LOGO_MAX, strip - 12));
    logo.style.width = size + 'px';
    logo.style.height = size + 'px';
    logo.style.left = Math.max(0, (strip - size) / 2) + 'px';
  }

  function fit(container, onScreen) {
    // Printing scales with CSS `zoom`, not transform: a transform leaves the card's layout box at full size, and the
    // browser then splits that oversized box across pages, cutting the card off. Zoom shrinks the layout box itself.
    // The on-screen preview (onScreen) has no pages to split, and zoom cannot draw 1px borders thinner than a pixel,
    // which wrecks a phone-sized preview -- so it scales with transform instead.
    var scaleIt = function (el, s) {
      if (onScreen) { el.style.zoom = ''; el.style.transformOrigin = '0 0'; el.style.transform = 'scale(' + s + ')'; }
      else { el.style.transform = ''; el.style.zoom = s; }
    };
    var clearScale = function (el) { el.style.zoom = ''; el.style.transform = ''; };
    // Zoom rounds text and row heights a little differently from the full-size measurement, so the real result can come out a
    // touch bigger than predicted. Measure what was actually drawn and shrink until it truly fits its box.
    var settle = function (el, scale, maxW, maxH) {
      for (var i = 0; i < 4; i++) {
        var r = el.getBoundingClientRect();
        var over = Math.max(r.width / maxW, r.height / maxH);
        if (over <= 1.002) break;
        scale = (scale / over) * 0.998;
        scaleIt(el, scale);
      }
      return el.getBoundingClientRect();
    };
    var cards = container.querySelectorAll('.sf9-card');
    Array.prototype.forEach.call(cards, function (card) {
      clearScale(card);
      fitText_(card); // measured at full size, before the card is scaled down
      var key = card.getAttribute('data-frame');
      var lt = card.querySelector('.sf9-left table'), rt = card.querySelector('.sf9-right table');
      lt.style.height = ''; rt.style.height = '';
      var ga = lt.querySelector('tr[data-ga]');
      var guard = 0;
      while (ga && rt.offsetHeight - lt.offsetHeight >= 34 && guard++ < 25) {
        ga.insertAdjacentHTML('beforebegin', blankRow(key));
      }
      var h = Math.max(lt.offsetHeight, rt.offsetHeight);
      lt.style.height = h + 'px'; rt.style.height = h + 'px'; // soaks up any last few px so the two borders line up
      var pos = card.parentNode, page = pos.parentNode;
      var boxW = page.clientWidth - 8, boxH = page.clientHeight - 8; // a 4px inset so the outer border is never clipped by the page edge
      var w = card.offsetWidth, ch = card.offsetHeight;
      var s = Math.min(boxW / w, boxH / ch);
      scaleIt(card, s);
      var drawn = settle(card, s, boxW, boxH);
      pos.style.left = (4 + Math.max(0, (boxW - drawn.width) / 2)) + 'px';
      pos.style.top = (4 + Math.max(0, (boxH - drawn.height) / 2)) + 'px';
    });
    var slips = container.querySelectorAll('.slip-cell .slip');
    Array.prototype.forEach.call(slips, function (slip) {
      clearScale(slip);
      placeSlipLogo_(slip); // measured at full size, before the slip is scaled
      var pos = slip.parentNode, cell = pos.parentNode;
      var w = slip.offsetWidth, h = slip.offsetHeight;
      var maxW = cell.clientWidth - 16, maxH = cell.clientHeight - 2 * SLIP_CUT_MARGIN;
      var s = Math.min(1, maxW / w, maxH / h);
      scaleIt(slip, s);
      var drawn = settle(slip, s, maxW, maxH);
      pos.style.left = Math.max(0, (cell.clientWidth - drawn.width) / 2) + 'px';
      pos.style.top = SLIP_CUT_MARGIN + 'px';
    });
  }


  // ---------- PDF download ----------
  //
  // The browser's print dialog has its own ideas (paper, orientation, scaling, margins) and a PDF saved through it can come
  // out differently on every computer. This makes the PDF directly instead: each page is drawn exactly as the app lays it
  // out, as an image, and the images are put into a PDF file. Pages are Letter (landscape for report cards, portrait for
  // grade slips), at 200 dpi, so they print sharply. The text in the PDF is part of the picture, not selectable.

  var PAPER = { card: { w: 1056, h: 816 }, slip: { w: 816, h: 1056 } }; // Letter, in CSS px (96 per inch)
  var PDF_DPI = 200;
  var SLIP_CUT_MARGIN = 30; // px of clear space between a slip and the dashed cutting line, above and below it

  function pageToJpeg_(pageEl, kind) {
    var paper = PAPER[kind], box = BOX[kind];
    var scale = PDF_DPI / 96;
    var xml = new XMLSerializer().serializeToString(pageEl);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + paper.w + '" height="' + paper.h + '">' +
      '<rect width="100%" height="100%" fill="#ffffff"/>' +
      '<foreignObject x="' + ((paper.w - box.w) / 2) + '" y="' + ((paper.h - box.h) / 2) + '" width="' + box.w + '" height="' + box.h + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="sf9"><style><![CDATA[' + LAYOUT_CSS + ']]></style>' + xml + '</div></foreignObject></svg>';
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(paper.w * scale); canvas.height = Math.round(paper.h * scale);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            var w = canvas.width, h = canvas.height;
            canvas.width = 0; // release the memory straight away: a class is dozens of these
            if (!blob) { reject(new Error('This browser could not make the page image.')); return; }
            blob.arrayBuffer().then(function (buf) { resolve({ bytes: new Uint8Array(buf), w: w, h: h }); }, reject);
          }, 'image/jpeg', 0.9);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('This browser could not draw the page.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** A PDF with one full-page JPEG per page. pageW / pageH are in PDF points (1/72 inch). */
  function buildPdf_(jpegs, pageW, pageH) {
    var enc = new TextEncoder();
    var chunks = [], offsets = [], length = 0;
    function put(part) { var b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); length += b.length; }
    function obj(id, body, stream) {
      offsets[id] = length;
      put(id + ' 0 obj\n' + body);
      if (stream) { put('\nstream\n'); put(stream); put('\nendstream'); }
      put('\nendobj\n');
    }
    var n = jpegs.length;
    put('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    jpegs.forEach(function (j, i) {
      var pageId = 3 + i * 3, contentId = pageId + 1, imageId = pageId + 2;
      var content = 'q ' + pageW + ' 0 0 ' + pageH + ' 0 0 cm /Im0 Do Q';
      obj(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
      obj(contentId, '<< /Length ' + content.length + ' >>', content);
      obj(imageId, '<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.bytes.length + ' >>', j.bytes);
    });
    var size = 3 + n * 3;
    var xrefAt = length;
    var xref = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (var id = 1; id < size; id++) xref += ('0000000000' + offsets[id]).slice(-10) + ' 00000 n \n';
    put(xref + 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  }

  /** The finished PDF, as a Blob. onProgress(done, total) is called as each page is made. */
  function makePdf(kind, learners, cls, school, onProgress) {
    var host = document.createElement('div');
    host.className = 'sf9';
    host.style.cssText = 'position:absolute;left:-100000px;top:0';
    host.innerHTML = pagesHtml(kind, learners, cls, school);
    document.body.appendChild(host);
    var cleanup = function () { if (host.parentNode) host.parentNode.removeChild(host); };
    try { fit(host); } catch (e) { cleanup(); return Promise.reject(e); }
    var pages = Array.prototype.slice.call(host.querySelectorAll(kind === 'card' ? '.sf9-page' : '.slip-page'));
    var jpegs = [];
    if (onProgress) onProgress(0, pages.length);
    return pages.reduce(function (chain, page, i) {
      return chain.then(function () {
        return pageToJpeg_(page, kind).then(function (jpeg) { jpegs.push(jpeg); if (onProgress) onProgress(i + 1, pages.length); });
      });
    }, Promise.resolve()).then(function () {
      cleanup();
      return buildPdf_(jpegs, PAPER[kind].w * 0.75, PAPER[kind].h * 0.75);
    }, function (e) { cleanup(); throw e; });
  }


  // ---------- CSS ----------

  var LAYOUT_CSS =
    // The app turns every <table> into a scrolling box on narrow windows (phones, high browser zoom) and pads every cell.
    // None of that may reach a report: a report is a fixed page, whatever the window or the print dialog looks like.
    '.sf9 table,.slip table{display:table !important;overflow:visible !important;max-width:none !important;margin:0;white-space:normal;-webkit-overflow-scrolling:auto}' +
    '.sf9 table.sf9t{width:auto}' +
    '.sf9-page,.slip-page{position:relative;overflow:hidden;background:#fff;color:#000;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.sf9-pos{position:absolute;left:0;top:0}' +
    '.sf9-card{display:flex;align-items:flex-start;background:#fff}' +
    '.sf9-panel{position:relative;flex:none}' +
    '.sf9-gap{flex:none}' +
    '.sf9 table.sf9t{border-collapse:collapse;table-layout:fixed;border-spacing:0;margin:0;width:auto;font-size:inherit}' +
    '.sf9 table.sf9t td{padding:0 2px;line-height:1.2;overflow:visible;box-sizing:border-box;background:none}' +
    '.sf9 table.sf9t td.na{background:' + (D.frames.shs.gray || '#a5a5a5') + '}' +
    '.sf9-seal,.sf9-logo{position:absolute;object-fit:contain}' +
    D.css +
    // Grade slip: the student view's styles (student.html), scoped, with the on-screen paddings tightened to fit two per page
    '.slip-page{display:flex;flex-direction:column}' +
    '.slip-cell{position:relative;box-sizing:border-box;flex:none;overflow:hidden;border-bottom:1px dashed #999}' +
    '.slip-cell:last-child{border-bottom:none}' +
    '.slip{position:relative;width:720px;font-family:Arial,Helvetica,sans-serif;color:#0B0B0B;background:#fff}' +
    '.slip .slip-logo{position:absolute;left:0;top:0;width:72px;height:72px;object-fit:contain}' +
    // with a logo, a long school name wraps before it reaches the strip the logo sits in, instead of running into it
    '.slip.has-logo .report-header{padding:0 84px}' +
    '.slip .grades-table{width:100%;border-collapse:collapse;font-size:0.92rem}' +
    '.slip .grades-table th{text-align:center;font-size:0.78rem;font-weight:600;color:#375534;padding:4px 4px;border:1px solid #AEC3B0}' +
    '.slip .grades-table th:first-child,.slip .grades-table td:first-child{text-align:left}' +
    '.slip .grades-table td{padding:4px 4px;border:1px solid #AEC3B0;text-align:center}' +
    '.slip .grades-table .subj{font-weight:500}' +
    '.slip .grades-table .num{font-weight:600;color:#0F2A1D}' +
    '.slip .grades-table .dash{color:#99a}' +
    '.slip .grades-table .final{font-weight:700;background:#E3EED4}' +
    '.slip .grades-table .desc{text-align:left;font-size:0.85rem;color:#444;white-space:nowrap}' +
    '.slip .grades-table .component-row .comp-name{padding-left:22px;font-style:italic;font-weight:400;color:#555;font-size:0.88rem}' +
    '.slip .grades-table .component-row td{padding-top:2px;padding-bottom:2px}' +
    '.slip .grades-table .component-row td.num,.slip .grades-table .component-row td.dash{font-style:italic;font-size:0.85rem}' +
    '.slip .report-table{table-layout:fixed}' +
    '.slip .report-table col.term-col{width:42px}.slip .report-table col.final-col{width:56px}.slip .report-table col.desc-col{width:104px}.slip .report-table col.remark-col{width:84px}' +
    '.slip .report-table.grades-table th:first-child{text-align:center}' +
    '.slip .report-table thead th{background:#0F2A1D;color:#fff;border-color:rgba(255,255,255,0.3);-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.slip .report-table .remark{text-align:left;font-size:0.85rem;color:#444}' +
    '.slip .report-table .remark.pass{color:#2E5B3E;font-weight:600}.slip .report-table .remark.fail{color:#A3402F;font-weight:600}' +
    '.slip .report-table tr.category-row td{background:#E3EED4;font-weight:700;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.03em;color:#375534;text-align:left}' +
    '.slip .report-table tr.general-average-row td{font-weight:700;background:#F2F6EE}' +
    '.slip .report-table tr.general-average-row .ga-label{text-align:right;padding-right:12px}' +
    '.slip .report-header{text-align:center;margin-bottom:4px}' +
    '.slip .report-school{font-weight:700;font-size:1.05rem;text-transform:uppercase;color:#0F2A1D;letter-spacing:0.02em}' +
    '.slip .report-year{font-size:0.85rem;color:#555;margin-top:2px}' +
    '.slip .report-title{font-weight:700;font-size:0.95rem;color:#0F2A1D;text-transform:uppercase;letter-spacing:0.01em;margin-top:6px}' +
    '.slip .report-powered{font-size:0.72rem;color:#888;font-style:italic;margin-top:3px}' +
    '.slip .report-brand{font-size:0.8rem;font-weight:700;color:#375534;margin-top:1px}' +
    '.slip .report-info-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:14px;row-gap:3px;font-size:0.84rem;margin:8px 0 8px}' +
    '.slip .report-info-grid .full{grid-column:1/-1}.slip .report-info-grid .info-label{color:#666}' +
    '.slip .report-info-grid .info-value{font-weight:600;color:#0F2A1D;margin-left:4px}' +
    '.slip .report-info-grid .info-spacer{grid-column:1/-1;height:0.5em}' +
    '.slip .report-info-grid .info-shift-right{margin-left:1in}' +
    '.slip .grades-table tr:not(.component-row) td.subj{padding-left:1cm}' +
    '.slip .grades-table .component-row .comp-name{padding-left:calc(22px + 1cm)}';

  return { BOX: BOX, css: LAYOUT_CSS, pagesHtml: pagesHtml, fit: fit, makePdf: makePdf, cardHtml: cardHtml, slipHtml: slipHtml, isSHS: isSHS };
})();
