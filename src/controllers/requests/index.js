const createRequest = require('./createRequest');
const getCustomerRequests = require('./getCustomerRequests');
const getCustomerHistory = require('./getCustomerHistory');
const cancelRequest = require('./cancelRequest');
const getPendingRequests = require('./getPendingRequests');
const acceptRequest = require('./acceptRequest');
const getProviderAssignedRequests = require('./getProviderAssignedRequests');
const updateRequestStatus = require('./updateRequestStatus');
const cancelAssignedRequest = require('./cancelAssignedRequest');
const getProviderHistory = require('./getProviderHistory');
const deleteRequest = require('./deleteRequest');
const repeatRequest = require('./repeatRequest');

module.exports = {
  createRequest,
  getCustomerRequests,
  getCustomerHistory,
  cancelRequest,
  getPendingRequests,
  acceptRequest,
  getProviderAssignedRequests,
  updateRequestStatus,
  cancelAssignedRequest,
  deleteRequest,
  repeatRequest,
  getProviderHistory,
};