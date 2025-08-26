const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path'); // Added
const ejs = require('ejs'); // Added
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const upload = multer({ dest: 'uploads/' });

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/');
  }
}

router.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: null });
  }
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.APP_PASSWORD) {
    req.session.user = { loggedIn: true };
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Incorrect password' });
  }
});

router.get('/dashboard', isAuthenticated, (req, res) => {
  const { status } = req.query;
  res.render('dashboard', { status: status });
});

// Function to get analytics emails from .env
function getAnalyticsEmails() {
  const emails = [];
  for (let i = 1; i <= 4; i++) { // Assuming up to ANALYTICS_EMAIL_4
    const email = process.env[`ANALYTICS_EMAIL_${i}`];
    if (email) {
      emails.push(email);
    }
  }
  return emails;
}

// Function to send analytics report email
async function sendAnalyticsReport(stats, originalMessage, emailType, subject, successfulRecipients) {
  const analyticsEmails = getAnalyticsEmails();

  if (analyticsEmails.length === 0) {
    console.log('No analytics emails configured. Skipping report.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  const templatePath = path.join(__dirname, '../views/analytics_email.ejs');
  const html = await ejs.renderFile(templatePath, {
    totalEmails: stats.total,
    successfulEmails: stats.successful,
    failedEmails: stats.failed,
    subject: subject,
    emailType: emailType,
    originalMessage: originalMessage,
    successfulRecipients: successfulRecipients
  });

  const mailOptions = {
    from: `"G-Realm Studio Analytics" <${process.env.EMAIL_USER}>`,
    to: analyticsEmails.join(', '),
    subject: `Email Campaign Analytics Report: ${subject}`,
    html: html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Analytics report sent successfully.');
  } catch (error) {
    console.error('Error sending analytics report:', error);
  }
}


router.post('/send', isAuthenticated, upload.single('csvfile'), (req, res) => {
  const { message, emailType, subject } = req.body;
  const results = [];

  fs.createReadStream(req.file.path)
    .pipe(csv({ headers: ['schoolname', 'email'] }))
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      let successfulEmails = 0;
      let failedEmails = 0;
      const totalEmails = results.length;
      const successfulRecipients = [];

      const promises = results.map(row => {
        const mailOptions = {
          from: `"G-Realm Studio" <${process.env.EMAIL_USER}>`,
          to: row.email,
          subject: subject,
        };

        const personalizedMessage = message.replace(/\[School Name\]/g, row.schoolname);

        if (emailType === 'html') {
          mailOptions.html = personalizedMessage;
        } else {
          mailOptions.text = personalizedMessage;
        }

        return transporter.sendMail(mailOptions)
          .then(() => {
            successfulEmails++;
            successfulRecipients.push({ schoolname: row.schoolname, email: row.email });
          })
          .catch(error => {
            console.error(`Failed to send email to ${row.email}:`, error);
            failedEmails++;
          });
      });

      await Promise.all(promises);

      // Write successful recipients to CSV
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, '../uploads/last_report.csv'),
        header: [
          { id: 'schoolname', title: 'School Name' },
          { id: 'email', title: 'Email' },
        ],
      });

      await csvWriter.writeRecords(successfulRecipients);

      // Send analytics report
      await sendAnalyticsReport({
        total: totalEmails,
        successful: successfulEmails,
        failed: failedEmails
      }, message, emailType, subject, successfulRecipients);

      fs.unlinkSync(req.file.path);
      res.redirect('/dashboard?status=success');
    });
});

router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.redirect('/dashboard');
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

router.get('/download-csv', (req, res) => {
  const filePath = path.join(__dirname, '../uploads/last_report.csv');
  res.download(filePath, 'campaign_report.csv', (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).send('Could not download the file.');
    }
  });
});

module.exports = router;