let topics = {}; // { topicName: Set<ws> }

function subscribe(ws, topic) {
    if (!topics[topic]) topics[topic] = new Set();
    topics[topic].add(ws);
    ws.topics = ws.topics || new Set();
    ws.topics.add(topic);
}

function unsubscribeFromTopic(ws, topic) {
    if (!topics[topic]) return;
    topics[topic].delete(ws);
    ws.topics?.delete(topic);
    if (topics[topic].size === 0) delete topics[topic];
}

function unsubscribeAll(ws) {
    if (!ws.topics) return;
    ws.topics.forEach(topic => {
        topics[topic]?.delete(ws);
        if (topics[topic]?.size === 0) delete topics[topic];
    });
    ws.topics.clear();
}

function publish(topic, message) {
    if (!topics[topic]) return;
    topics[topic].forEach(ws => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    });
}

module.exports = { subscribe, unsubscribeFromTopic, unsubscribeAll, publish };
