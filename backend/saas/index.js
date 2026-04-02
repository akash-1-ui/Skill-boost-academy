const router = require('./router');
const { ensureMultiTenantSchema } = require('./schema');

module.exports = {
    saasRouter: router,
    ensureMultiTenantSchema
};
