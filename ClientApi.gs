function clientRegister_(fullName, email, password) {
  try {
    registerTeacher_({ fullName: fullName, email: email, password: password });
    return { ok: true, message: 'If this email can be registered, a verification link has been sent.' };
  } catch (e) {
    if (e && e.isValidation) return { ok: false, error: e.message };
    return { ok: false, error: 'Registration failed. Please try again.' };
  }
}

function clientLogin_(email, password) {
  var result = loginTeacher_(email, password);
  if (!result) return { ok: false, error: 'Invalid email or password, or email not yet verified.' };
  return { ok: true, sessionToken: result.sessionToken };
}

function clientPing_() {
  return { ok: true, data: { pong: true } };
}

function clientOnboard_(sessionToken) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: ensureTeacherOnboarded_(teacherId) };
}

function clientGetLicenseStatus_(sessionToken) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: getLicenseStatus_(teacherId) };
}

function clientRequestPasswordReset_(email) {
  try {
    requestPasswordReset_(email);
  } catch (e) { /* swallow -- same generic response regardless, rule §17 */ }
  return { ok: true, message: 'If that email is registered, a reset link has been sent.' };
}

function clientResetPassword_(token, newPassword) {
  var success = resetPassword_(token, newPassword);
  if (!success) return { ok: false, error: 'This reset link is invalid or has expired.' };
  return { ok: true };
}

function clientChangePassword_(sessionToken, currentPassword, newPassword) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  var success = changePassword_(teacherId, currentPassword, newPassword);
  if (!success) return { ok: false, error: 'Current password is incorrect.' };
  return { ok: true };
}

function clientListWorkspaces_(sessionToken) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: listWorkspaces_(teacherId) };
}

function clientGetMyProfile_(sessionToken) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: getTeacherProfile_(teacherId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientCreateWorkspace_(sessionToken, schoolYearLabel, gradeLevel, section, schoolName, adviserName, adviserDesignation, track, cluster) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: createWorkspace_(teacherId, {
      schoolYearLabel: schoolYearLabel, gradeLevel: gradeLevel, section: section, schoolName: schoolName,
      adviserName: adviserName, adviserDesignation: adviserDesignation, track: track, cluster: cluster, failIfExists: true,
    }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUpdateWorkspace_(sessionToken, workspaceId, schoolYearLabel, gradeLevel, section, schoolName, adviserName, adviserDesignation, track, cluster) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: updateWorkspace_(teacherId, workspaceId, {
      schoolYearLabel: schoolYearLabel, gradeLevel: gradeLevel, section: section, schoolName: schoolName,
      adviserName: adviserName, adviserDesignation: adviserDesignation, track: track, cluster: cluster,
    }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientDeleteWorkspace_(sessionToken, workspaceId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: deleteWorkspace_(teacherId, workspaceId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientListClassSubjects_(sessionToken, workspaceId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: listClassSubjectsForWorkspace_(teacherId, workspaceId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientCreateClassSubject_(sessionToken, workspaceId, subjectCode, customSubjectName, category) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: createClassSubjectForManualEntry_(teacherId, { workspaceId: workspaceId, subjectCode: subjectCode, customSubjectName: customSubjectName, category: category }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientDeleteClassSubject_(sessionToken, classSubjectId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: deleteClassSubject_(teacherId, classSubjectId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientListRoster_(sessionToken, workspaceId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: listRosterForWorkspace_(teacherId, workspaceId) };
}

// Combines what login (and a periodic quiet refresh) needs into one round trip instead of four:
// profile+license, the workspace list, and the active workspace's subjects and roster. Grade data is
// deliberately NOT included here -- it's per subject/term, can be large, and the teacher may have it
// open mid-edit; it stays on its own on-demand call (clientGetClassRecordGrades_).
function clientGetWorkspaceBundle_(sessionToken, preferredWorkspaceId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    var profile = getTeacherProfile_(teacherId);
    var workspaces = listWorkspaces_(teacherId);
    var ids = workspaces.map(function (w) { return w.workspaceId; });
    var activeWorkspaceId = ids.indexOf(preferredWorkspaceId) !== -1
      ? preferredWorkspaceId
      : (ids.length > 0 ? ids[0] : null);

    return {
      ok: true,
      data: {
        profile: profile,
        workspaces: workspaces,
        activeWorkspaceId: activeWorkspaceId,
        classSubjects: activeWorkspaceId ? listClassSubjectsForWorkspace_(teacherId, activeWorkspaceId) : [],
        roster: activeWorkspaceId ? listRosterForWorkspace_(teacherId, activeWorkspaceId) : [],
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientAddStudent_(sessionToken, workspaceId, lrn, fullName, sex) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: addStudentToRoster_(teacherId, workspaceId, { lrn: lrn, fullName: fullName, sex: sex }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUpdateStudent_(sessionToken, enrollmentId, lrn, fullName, sex) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: updateStudentDetails_(teacherId, enrollmentId, { lrn: lrn, fullName: fullName, sex: sex }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientImportStudents_(sessionToken, workspaceId, rows) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: importStudentsToRoster_(teacherId, workspaceId, rows) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Grades manual entry and ECR upload

function clientSaveManualGrades_(sessionToken, classSubjectId, term, entries) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: saveManualGrades_(teacherId, classSubjectId, term, entries) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUpdateStudentLrn_(sessionToken, enrollmentId, lrn) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: updateStudentLrn_(teacherId, enrollmentId, lrn) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientPreviewEcrUpload_(sessionToken, base64Data, filename, mimeType) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    // The upload is read in memory (XlsxReader.gs): nothing is saved to Drive.
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, filename);
    var workbook = readXlsxWorkbook_(blob);
    return { ok: true, data: previewEcrUpload_(teacherId, workbook) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientResolveEcrMatchToExisting_(sessionToken, previewId, learnerName, enrollmentId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: resolveEcrMatchToExisting_(teacherId, previewId, learnerName, enrollmentId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientConfirmEcrUpload_(sessionToken, previewId, selectedTerms) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: confirmEcrUpload_(teacherId, previewId, selectedTerms) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientGetClassRecordGrades_(sessionToken, classSubjectId, term) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: getClassRecordGradesForReview_(teacherId, classSubjectId, term) };
}

function clientPublish_(sessionToken, classSubjectId, term) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: publishClassRecord_(teacherId, classSubjectId, term) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUnpublish_(sessionToken, classSubjectId, term) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: unpublishClassRecord_(teacherId, classSubjectId, term) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientPublishLearner_(sessionToken, classSubjectId, term, enrollmentId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: publishLearnerGrade_(teacherId, classSubjectId, term, enrollmentId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUnpublishLearner_(sessionToken, classSubjectId, term, enrollmentId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: unpublishLearnerGrade_(teacherId, classSubjectId, term, enrollmentId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientStudentLogin_(lrn, surname) {
  var result = loginStudent_(lrn, surname);
  if (!result) return { ok: false, error: 'We could not verify those details. Please check and try again.' };
  return { ok: true, data: { pendingToken: result.pendingToken, stage: result.stage } };
}

function clientCompleteStudentPinSetup_(pendingToken, pin, confirmPin) {
  try {
    return { ok: true, data: completeStudentPinSetup_(pendingToken, pin, confirmPin) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientVerifyStudentPin_(pendingToken, pin) {
  try {
    return { ok: true, data: verifyStudentPin_(pendingToken, pin) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientResetStudentPin_(sessionToken, studentId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: resetStudentPin_(teacherId, studentId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientGetMyGrades_(sessionToken) {
  var studentId = validateSession_(sessionToken, 'student');
  if (!studentId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: getPublishedGradesForStudent_(studentId) };
}

// ADMIN client functions

function clientAdminLogin_(email, password) {
  var result = loginAdmin_(email, password);
  if (!result) return { ok: false, error: 'Invalid email or password.' };
  return { ok: true, sessionToken: result.sessionToken };
}

function clientGetDashboardStats_(sessionToken) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: getAdminDashboardStats_() };
}

function clientListTeachersForAdmin_(sessionToken, searchQuery) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: listTeachersForAdmin_(searchQuery) };
}

function clientGetTeacherDetailForAdmin_(sessionToken, teacherId) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: getTeacherDetailForAdmin_(teacherId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientExtendTrial_(sessionToken, teacherId, newTrialEndIso) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    extendTrial_(adminId, teacherId, newTrialEndIso);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientActivateLicense_(sessionToken, teacherId, expirationIso) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    activateLicense_(adminId, teacherId, expirationIso);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientExtendLicense_(sessionToken, teacherId, newExpirationIso) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    extendLicense_(adminId, teacherId, newExpirationIso);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientSuspendAccount_(sessionToken, teacherId) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    suspendAccount_(adminId, teacherId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientReactivateAccount_(sessionToken, teacherId, restoredStatus) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    reactivateAccount_(adminId, teacherId, restoredStatus);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientListAuditLogs_(sessionToken, filters) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: listAuditLogsForAdmin_(filters) };
}

function clientGetSystemSettings_(sessionToken) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  return { ok: true, data: getSystemSettings_() };
}

function clientUpdateSystemSettings_(sessionToken, trialDurationDays) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    updateSystemSettings_(adminId, trialDurationDays);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- License requests 

function clientGetLicenseRequestInfo_(sessionToken) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: getLicenseRequestInfo_(teacherId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientSubmitLicenseRequest_(sessionToken, paymentReference, message, plan) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: submitLicenseRequest_(teacherId, { paymentReference: paymentReference, message: message, plan: plan }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientCancelLicenseRequest_(sessionToken, requestId) {
  var teacherId = validateSession_(sessionToken, 'teacher');
  if (!teacherId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: cancelLicenseRequest_(teacherId, requestId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientListLicenseRequests_(sessionToken, status) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: listLicenseRequestsForAdmin_(status) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientApproveLicenseRequest_(sessionToken, requestId, expirationIso, note) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: approveLicenseRequest_(adminId, requestId, expirationIso, note) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientDeclineLicenseRequest_(sessionToken, requestId, note) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: declineLicenseRequest_(adminId, requestId, note) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientUpdateLicenseSettings_(sessionToken, instructions, monthlyPrice, yearlyPrice) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    updateLicenseSettings_(adminId, instructions, monthlyPrice, yearlyPrice);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientBulkApplyAdminAction_(sessionToken, teacherIds, action, params) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  try {
    return { ok: true, data: bulkApplyAdminAction_(adminId, teacherIds, action, params || {}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clientWipeAllDataForTesting_(sessionToken, confirmationPhrase) {
  var adminId = validateSession_(sessionToken, 'admin');
  if (!adminId) return { ok: false, error: 'Session expired. Please log in again.' };
  if (confirmationPhrase !== 'DELETE ALL DATA') {
    return { ok: false, error: 'Confirmation phrase did not match. Nothing was deleted.' };
  }
  try {
    return { ok: true, data: wipeAllDataForTesting_(adminId) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}