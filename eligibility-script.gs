/**
 * Eligibility checker for Engramme Evaluation
 *
 * Setup:
 * 1. Open the Google Sheet linked to the eligibility form responses
 * 2. Extensions > Apps Script
 * 3. Paste this script
 * 4. Update PASSCODE and FROM_ALIAS below
 * 5. Run processNewResponses() manually, or set up a trigger for automatic processing
 *
 * To auto-run on new submissions:
 *   Triggers > Add Trigger > processNewResponses > From spreadsheet > On form submit
 */

var PASSCODE = 'engramme2026'; // site passcode to include in eligible emails
var SITE_URL = 'https://engrammeevaluations.vercel.app/#welcome';
var MIN_EMAILS = 2000;
var MIN_DRIVE_GB = 10;

// Column headers (must match your sheet exactly)
var COL_FIRST_NAME = 'First Name';
var COL_EMAIL = 'Personal Email (please use your gmail)';
var COL_AGE_CHECK = 'Are you 18 or older?';
var COL_FLUENCY = 'What is your fluency with English?';
// Column headers for email count and drive size (current form)
var COL_NUM_EMAILS = 'Please go to gmail.com on a desktop browser, open your Inbox, and enter the total number of emails displayed above your message list.';
var COL_DRIVE_SIZE = 'Please go to drive.google.com on a desktop browser and enter the total storage used shown for your Google account near the bottom left. Please use GB as the unit. \n\nFor example: 5 GB or 5 gb.';

// Status column name (added by script to track who's been emailed)
var COL_STATUS = 'Eligibility Status';

function processNewResponses() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find or create status column
  var statusCol = headers.indexOf(COL_STATUS);
  if (statusCol === -1) {
    statusCol = headers.length;
    sheet.getRange(1, statusCol + 1).setValue(COL_STATUS);
    headers.push(COL_STATUS);
  }

  var colMap = {};
  var trimmedHeaders = headers.map(function(h) { return h.toString().trim(); });
  for (var i = 0; i < trimmedHeaders.length; i++) {
    colMap[trimmedHeaders[i]] = i; // last occurrence wins
  }

  // For duplicated columns, find the LAST one (where form data goes)
  var colNumEmails = lastIndexOf(trimmedHeaders, COL_NUM_EMAILS.trim());
  var colDriveSize = lastIndexOf(trimmedHeaders, COL_DRIVE_SIZE.trim());

  var processed = 0;
  var eligible = 0;
  var ineligible = 0;

  for (var row = 1; row < data.length; row++) {
    var status = data[row][statusCol];
    if (status === 'Eligible' || status === 'Not Eligible') continue; // already processed

    var firstName = (data[row][colMap[COL_FIRST_NAME]] || '').toString().trim();
    var email = (data[row][colMap[COL_EMAIL]] || '').toString().trim();
    var ageCheck = (data[row][colMap[COL_AGE_CHECK]] || '').toString().trim();
    var fluency = (data[row][colMap[COL_FLUENCY]] || '').toString().trim();
    var numEmails = parseNumber(colNumEmails >= 0 ? data[row][colNumEmails] : 0);
    var driveGB = parseDriveSize(colDriveSize >= 0 ? data[row][colDriveSize] : 0);

    if (!email) continue;

    var isEligible = checkEligibility(ageCheck, fluency, numEmails, driveGB);

    if (isEligible) {
      sendEligibleEmail(email, firstName);
      sheet.getRange(row + 1, statusCol + 1).setValue('Eligible');
      eligible++;
    } else {
      sendIneligibleEmail(email, firstName);
      sheet.getRange(row + 1, statusCol + 1).setValue('Not Eligible');
      ineligible++;
    }
    processed++;
  }

  Logger.log('Processed: ' + processed + ' | Eligible: ' + eligible + ' | Not Eligible: ' + ineligible);
  Logger.log('Email column index: ' + colNumEmails + ', Drive column index: ' + colDriveSize);
}

function checkEligibility(ageCheck, fluency, numEmails, driveGB) {
  // Must be 18+ (field contains actual age or "Yes")
  var age = parseInt(ageCheck);
  if (ageCheck !== 'Yes' && (isNaN(age) || age < 18)) return false;

  // Must be native or fluent
  if (fluency !== 'Native speaker' && fluency !== 'Fluent') return false;

  // Must have 2K+ emails OR 10+ GB drive
  if (numEmails < MIN_EMAILS && driveGB < MIN_DRIVE_GB) return false;

  return true;
}

function sendEligibleEmail(email, firstName) {
  var subject = 'You are eligible for the Engramme study!';
  var htmlBody = '\
<!DOCTYPE html>\
<html>\
<head>\
  <meta charset="UTF-8">\
  <meta name="viewport" content="width=device-width, initial-scale=1.0">\
</head>\
<body style="margin:0; padding:0; background-color:#faf9f5; font-family:\'DM Sans\', system-ui, -apple-system, sans-serif;">\
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9f5; padding:40px 20px;">\
    <tr>\
      <td align="center">\
        <table width="100%" style="max-width:520px; background:#ffffff; border-radius:16px; border:1px solid #e9e8e7; overflow:hidden;">\
          <tr>\
            <td style="padding:32px 32px 24px 32px;">\
              <h1 style="margin:0 0 8px 0; font-size:22px; font-weight:600; color:#151211;">You\'re in!</h1>\
              <p style="margin:0; font-size:15px; color:#2c2827; line-height:1.6;">\
                Hi ' + firstName + ', you are eligible to participate in the Engramme study.\
              </p>\
            </td>\
          </tr>\
          <tr>\
            <td style="padding:0 32px 24px 32px;">\
              <table width="100%" style="background:#f4f3f3; border-radius:12px; padding:20px;">\
                <tr>\
                  <td>\
                    <p style="margin:0 0 4px 0; font-size:12px; font-weight:500; color:#787270; text-transform:uppercase; letter-spacing:0.5px;">Site Passcode</p>\
                    <p style="margin:0; font-size:24px; font-weight:700; color:#151211; font-family:monospace; letter-spacing:1px;">' + PASSCODE + '</p>\
                  </td>\
                </tr>\
              </table>\
            </td>\
          </tr>\
          <tr>\
            <td style="padding:0 32px 32px 32px;">\
              <a href="' + SITE_URL + '" style="display:inline-block; background:#262626; color:#ffffff; font-size:15px; font-weight:500; text-decoration:none; padding:12px 24px; border-radius:8px;">Continue to Study →</a>\
              <p style="margin:16px 0 0 0; font-size:13px; color:#787270;">Open on a desktop browser to continue the process for the $100 payment.</p>\
            </td>\
          </tr>\
          <tr>\
            <td style="padding:20px 32px; border-top:1px solid #e9e8e7;">\
              <p style="margin:0; font-size:13px; color:#787270;">Engramme Team</p>\
            </td>\
          </tr>\
        </table>\
      </td>\
    </tr>\
  </table>\
</body>\
</html>';

  var plainBody = 'Hi ' + firstName + ',\n\nYou are eligible to participate in the study!\n\nPasscode: ' + PASSCODE + '\n\nGo to: ' + SITE_URL + '\n\nOpen on a desktop to continue the process for the $100 payment.\n\nEngramme Team';

  GmailApp.sendEmail(email, subject, plainBody, {htmlBody: htmlBody});
}

function sendIneligibleEmail(email, firstName) {
  var subject = 'Engramme study eligibility update';
  var htmlBody = '\
<!DOCTYPE html>\
<html>\
<head>\
  <meta charset="UTF-8">\
  <meta name="viewport" content="width=device-width, initial-scale=1.0">\
</head>\
<body style="margin:0; padding:0; background-color:#faf9f5; font-family:\'DM Sans\', system-ui, -apple-system, sans-serif;">\
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf9f5; padding:40px 20px;">\
    <tr>\
      <td align="center">\
        <table width="100%" style="max-width:520px; background:#ffffff; border-radius:16px; border:1px solid #e9e8e7; overflow:hidden;">\
          <tr>\
            <td style="padding:32px;">\
              <h1 style="margin:0 0 16px 0; font-size:20px; font-weight:600; color:#151211;">Thank you for your interest</h1>\
              <p style="margin:0; font-size:15px; color:#2c2827; line-height:1.6;">\
                Hi ' + firstName + ', based on your responses, you are not eligible to participate in this study. We appreciate your time.\
              </p>\
            </td>\
          </tr>\
          <tr>\
            <td style="padding:20px 32px; border-top:1px solid #e9e8e7;">\
              <p style="margin:0; font-size:13px; color:#787270;">Engramme Team</p>\
            </td>\
          </tr>\
        </table>\
      </td>\
    </tr>\
  </table>\
</body>\
</html>';

  var plainBody = 'Hi ' + firstName + ',\n\nBased on your responses, you are not eligible to participate in this study. Thank you for your time.\n\nEngramme Team';

  GmailApp.sendEmail(email, subject, plainBody, {htmlBody: htmlBody});
}

function parseNumber(val) {
  if (!val) return 0;
  var s = val.toString().replace(/,/g, '').trim();
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDriveSize(val) {
  if (!val) return 0;
  var s = val.toString().toLowerCase().replace(/,/g, '').trim();
  // Extract number before "gb"
  var match = s.match(/([\d.]+)\s*(gb|g)?/i);
  if (match) return parseFloat(match[1]);
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function lastIndexOf(arr, value) {
  for (var i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === value) return i;
  }
  return -1;
}

/**
 * Run this once to test with a dry run (no emails sent, but updates status column)
 */
function dryRun() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find or create status column
  var statusCol = headers.indexOf(COL_STATUS);
  if (statusCol === -1) {
    statusCol = headers.length;
    sheet.getRange(1, statusCol + 1).setValue(COL_STATUS);
    headers.push(COL_STATUS);
  }

  var colMap = {};
  var trimmedHeaders = headers.map(function(h) { return h.toString().trim(); });
  for (var i = 0; i < trimmedHeaders.length; i++) {
    colMap[trimmedHeaders[i]] = i;
  }

  var colNumEmails = lastIndexOf(trimmedHeaders, COL_NUM_EMAILS.trim());
  var colDriveSize = lastIndexOf(trimmedHeaders, COL_DRIVE_SIZE.trim());

  var eligible = 0;
  var ineligible = 0;

  for (var row = 1; row < data.length; row++) {
    var firstName = (data[row][colMap[COL_FIRST_NAME]] || '').toString().trim();
    var email = (data[row][colMap[COL_EMAIL]] || '').toString().trim();
    var ageCheck = (data[row][colMap[COL_AGE_CHECK]] || '').toString().trim();
    var fluency = (data[row][colMap[COL_FLUENCY]] || '').toString().trim();
    var numEmails = parseNumber(colNumEmails >= 0 ? data[row][colNumEmails] : 0);
    var driveGB = parseDriveSize(colDriveSize >= 0 ? data[row][colDriveSize] : 0);
    var isEligible = checkEligibility(ageCheck, fluency, numEmails, driveGB);

    if (isEligible) {
      sheet.getRange(row + 1, statusCol + 1).setValue('Eligible');
      eligible++;
    } else {
      sheet.getRange(row + 1, statusCol + 1).setValue('Not Eligible');
      ineligible++;
    }

    Logger.log(firstName + ' — ' + (isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'));
  }

  Logger.log('Done! Eligible: ' + eligible + ' | Not Eligible: ' + ineligible + ' | NO EMAILS SENT');
}
