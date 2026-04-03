const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patient');
const doctorRoutes = require('./routes/doctor');
const aiRoutes = require('./routes/ai');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/ai', aiRoutes);

app.get('/api/health/db', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database connection failed' });
  }
});

const clientDist = '/sessions/affectionate-kind-davinci/client_dist';
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(5001, () => console.log('Server+Client running at http://localhost:5001'));
