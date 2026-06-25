const getVersion = async (req, res) => {
  const minVersion = process.env.MIN_APP_VERSION || '1.0.0';
  res.json({ min_version: minVersion });
};

module.exports = { getVersion };
