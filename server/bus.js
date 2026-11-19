// In-process event bus. Used to push live stock changes to open browsers over Server-Sent Events.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

function publishStock(productId) {
  bus.emit('stock', { productId, at: Date.now() });
}

module.exports = { bus, publishStock };
