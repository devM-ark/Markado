var CALLABLE_CLIENT_FUNCTIONS = [
  'clientPing_', 'clientRegister_', 'clientLogin_', 'clientOnboard_', 'clientGetLicenseStatus_',
  'clientRequestPasswordReset_', 'clientResetPassword_', 'clientChangePassword_',
  'clientPreviewEcrUpload_', 'clientResolveEcrMatchToExisting_', 'clientConfirmEcrUpload_',
  'clientSaveManualGrades_', 'clientUpdateStudentLrn_',
  'clientGetMyProfile_', 'clientGetWorkspaceBundle_',
  'clientListWorkspaces_', 'clientCreateWorkspace_', 'clientUpdateWorkspace_', 'clientDeleteWorkspace_',
  'clientListClassSubjects_', 'clientCreateClassSubject_', 'clientDeleteClassSubject_',
  'clientListRoster_', 'clientAddStudent_', 'clientUpdateStudent_', 'clientImportStudents_', 'clientGetClassRecordGrades_',
  'clientPublish_', 'clientUnpublish_', 'clientPublishLearner_', 'clientUnpublishLearner_',
  'clientStudentLogin_', 'clientGetMyGrades_',
  'clientCompleteStudentPinSetup_', 'clientVerifyStudentPin_', 'clientResetStudentPin_',
  'clientAdminLogin_', 'clientGetDashboardStats_', 'clientListTeachersForAdmin_', 'clientGetTeacherDetailForAdmin_',
  'clientExtendTrial_', 'clientActivateLicense_', 'clientExtendLicense_', 'clientSuspendAccount_', 'clientReactivateAccount_',
  'clientListAuditLogs_', 'clientGetSystemSettings_', 'clientUpdateSystemSettings_',
  'clientBulkApplyAdminAction_', 'clientWipeAllDataForTesting_',
  'clientGetLicenseRequestInfo_', 'clientSubmitLicenseRequest_', 'clientCancelLicenseRequest_',
  'clientListLicenseRequests_', 'clientApproveLicenseRequest_', 'clientDeclineLicenseRequest_', 'clientUpdateLicenseSettings_',
];


function doGet(e) {
  resetRepoMemo_();
  var action = e.parameter.action;

  if (action === 'verifyEmail') {
    var result = verifyTeacherEmail_(e.parameter.token);
    if (!result) {
      return htmlResponse_('<h1>Link expired or invalid</h1><p>Please request a new verification email.</p>');
    }
    return htmlResponse_('<h1>Email verified</h1><p>You can now log in.</p>');
  }

  return jsonResponse_({ error: 'Unknown action' }, 400);
}

function doPost(e) {

  resetRepoMemo_();

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  var fn = body && body.fn;
  var args = (body && body.args) || [];
  if (!Array.isArray(args)) {
    return jsonResponse_({ ok: false, error: 'Invalid request arguments.' }, 400);
  }

  if (CALLABLE_CLIENT_FUNCTIONS.indexOf(fn) === -1) {
    return jsonResponse_({ ok: false, error: 'Unknown or unavailable function.' }, 400);
  }

  var startedAt = Date.now();
  try {
    var result = globalThis[fn].apply(null, args);
    var elapsed = Date.now() - startedAt;
    if (elapsed > 5000) console.warn('SLOW ' + fn + ' took ' + elapsed + 'ms'); // visible in Executions log
    return jsonResponse_(result, 200);
  } catch (err) {
    console.error(fn + ' failed: ' + (err && err.stack ? err.stack : err));
    return jsonResponse_({ ok: false, error: friendlyServerError_(err) }, 500);
  }
}

// Most thrown errors in this codebase are already a plain sentence a teacher wrote for another teacher to read
// ("Class not found.", "Subject category must be Core, Elective or Special.") -- those are passed through as-is.
// This is only here to catch the other kind: a genuine bug surfacing a raw JS/Apps Script exception ("TypeError:
// Cannot read properties of undefined...", "Exception: Service Spreadsheets failed..."), which is meaningless to
// the person using the app. The full message is still in the console log above either way, for whoever needs it.
var RAW_ERROR_PATTERNS_ = /(^[A-Za-z]+Error:|^Exception:|Cannot read propert|is not a function|is not defined|Service \w+ failed)/;

function friendlyServerError_(err) {
  var message = (err && err.message) || '';
  if (!message || RAW_ERROR_PATTERNS_.test(message)) {
    return 'Something went wrong on our end. Please try again, or let your school\'s Markado admin know if it keeps happening.';
  }
  return message;
}


function jsonResponse_(obj, statusCode) {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    obj = { ok: true, data: obj === undefined ? null : obj };
  }
  var payload = Object.assign({}, obj, { statusCode: statusCode });
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}


function htmlResponse_(html) {
  return HtmlService.createHtmlOutput(html);
}