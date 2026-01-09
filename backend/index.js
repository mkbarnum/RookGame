/**
 * Rook Backend - Lambda Handlers Index
 * 
 * This file exports all Lambda handlers for easy import.
 * Each handler is also available as a standalone module.
 * 
 * REST API Handlers:
 * - createGame: POST /createGame - Create a new game lobby
 * - joinGame: POST /joinGame - Join an existing game
 * 
 * WebSocket API Handlers:
 * - connect: $connect route - Player connects to WebSocket
 * - disconnect: $disconnect route - Player disconnects from WebSocket
 */

const { handler: createGame } = require('./handlers/createGame');
const { handler: joinGame } = require('./handlers/joinGame');
const { handler: choosePartner } = require('./handlers/choosePartner');
const { handler: connect } = require('./handlers/connect');
const { handler: disconnect } = require('./handlers/disconnect');

module.exports = {
  // REST API handlers
  createGame,
  joinGame,
  choosePartner,
  // WebSocket API handlers
  connect,
  disconnect,
};
