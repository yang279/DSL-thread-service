module.exports = {
  apps: [
    {
      name: 'node-dsl-pipeline',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PORT: 3104,
        DEFAULT_MODE: 'ipc',
        NODE_ENV: 'production'
      },
      env_development: {
        PORT: 3104,
        DEFAULT_MODE: 'ipc',
        NODE_ENV: 'development'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};