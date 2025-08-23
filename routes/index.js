
const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const nodemailer = require('nodemailer');
const fs = require('fs');

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

router.post('/send', isAuthenticated, upload.single('csvfile'), (req, res) => {
  const { message, emailType, subject } = req.body;
  const results = [];

  console.log('Received request to send emails.');
  console.log('Subject:', subject);
  console.log('Email Type:', emailType);

  fs.createReadStream(req.file.path)
    .pipe(csv({ headers: ['schoolname', 'email'] }))
    .on('data', (data) => results.push(data))
    .on('end', () => {
      console.log('CSV file processed. Found', results.length, 'records.');

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        debug: true // Enable debug output
      });

      console.log('Nodemailer transporter created.');

      const promises = results.map(row => {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: row.email,
          subject: subject,
        };

        if (emailType === 'html') {
          mailOptions.html = message;
        } else {
          mailOptions.text = message;
        }

        console.log(`Preparing to send email to: ${row.email}`);
        return transporter.sendMail(mailOptions);
      });

      Promise.all(promises)
        .then(() => {
          console.log('All emails sent successfully.');
          fs.unlinkSync(req.file.path);
          res.redirect('/dashboard?status=success');
        })
        .catch(error => {
          console.error('Error sending emails:', error);
          fs.unlinkSync(req.file.path);
          res.redirect('/dashboard?status=error');
        });
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

module.exports = router;
