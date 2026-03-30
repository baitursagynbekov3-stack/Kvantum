// Seed script — run once to populate initial services
// Usage: node seed.js

require('dotenv').config();
const mongoose = require('mongoose');
const Service = require('./models/Service');

const services = [
  {
    title: 'Brain Charge',
    description: 'Reality Reprogramming — 21 days, 15 minutes per day. Work with thoughts, feelings, and state transformation.',
    price: 1000,
    currency: 'KGS',
    duration: '21 days',
    availability: true
  },
  {
    title: 'Diagnostic',
    description: 'State Enhancement — 4 weeks. 2 sessions with Altynai, 2 sessions with curator. Build confidence, self-worth, and inner freedom.',
    price: 5000,
    currency: 'KGS',
    duration: '4 weeks',
    availability: true
  },
  {
    title: 'Intensive "Mom & Dad - My 2 Wings"',
    description: 'Deep Root Work — 1 month, 10 lessons, 20 practices, 3 Zoom sessions. Separation, breaking inherited patterns, restoring family hierarchy.',
    price: 300,
    currency: 'USD',
    duration: '1 month',
    availability: true
  },
  {
    title: 'REBOOT',
    description: 'Conscious Reality Management — 8 weeks, 24 sessions, 20 lessons & 20 practices. Values, state management, relationships, finances.',
    price: 1000,
    currency: 'USD',
    duration: '8 weeks',
    availability: true
  },
  {
    title: 'Mentorship',
    description: 'University of Self-Knowledge — Field reading, emotions & subconscious blocks, quantum field mastery, 30 NLP practices, constellation fundamentals.',
    price: 0,
    currency: 'USD',
    duration: 'Ongoing',
    availability: true
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing services
    await Service.deleteMany({});
    console.log('Cleared existing services');

    // Insert new services
    const created = await Service.insertMany(services);
    console.log(`Seeded ${created.length} services:`);
    created.forEach(s => console.log(`  - ${s.title} (${s.price} ${s.currency})`));

    await mongoose.disconnect();
    console.log('Done!');
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
}

seed();
