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

  function slipHtml(learner, cls) {
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

    return '<div class="slip">' + header +
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
        var cell = function (l) { return '<div class="slip-cell" style="height:' + Math.floor(b.h / 2) + 'px">' + (l ? '<div class="sf9-pos">' + slipHtml(l, cls) + '</div>' : '') + '</div>'; };
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
    var cards = container.querySelectorAll('.sf9-card');
    Array.prototype.forEach.call(cards, function (card) {
      clearScale(card);
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
      pos.style.left = (4 + Math.max(0, (boxW - w * s) / 2)) + 'px';
      pos.style.top = (4 + Math.max(0, (boxH - ch * s) / 2)) + 'px';
    });
    var slips = container.querySelectorAll('.slip-cell .slip');
    Array.prototype.forEach.call(slips, function (slip) {
      clearScale(slip);
      var pos = slip.parentNode, cell = pos.parentNode;
      var w = slip.offsetWidth, h = slip.offsetHeight;
      var s = Math.min(1, (cell.clientWidth - 16) / w, (cell.clientHeight - 16) / h);
      scaleIt(slip, s);
      pos.style.left = Math.max(0, (cell.clientWidth - w * s) / 2) + 'px';
      pos.style.top = '8px';
    });
  }


  // ---------- CSS ----------

  var LAYOUT_CSS =
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
    '.slip{width:720px;font-family:Arial,Helvetica,sans-serif;color:#0B0B0B;background:#fff}' +
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

  return { BOX: BOX, css: LAYOUT_CSS, pagesHtml: pagesHtml, fit: fit, cardHtml: cardHtml, slipHtml: slipHtml, isSHS: isSHS };
})();
