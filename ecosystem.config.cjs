const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  apps: [{
    name: 'difflens-api',
    script: 'npm',
    args: 'run dev',
    cwd: '/home/homelander/apps/DiffLens/api',
    env: {
      ...process.env
    }
  }]
};