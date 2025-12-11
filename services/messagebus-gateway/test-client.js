// Simple test client to verify the messagebus-gateway functionality
const WebSocket = require('ws');

class TestClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.subscriptions = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        console.log('Connected to messagebus-gateway');
        resolve();
      });

      this.ws.on('error', reject);

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('Disconnected from messagebus-gateway');
      });
    });
  }

  handleMessage(message) {
    console.log('Received:', message);
    
    if (message.type === 'message') {
      // Convert number array back to string for display
      if (Array.isArray(message.data)) {
        const bytes = new Uint8Array(message.data);
        const text = new TextDecoder().decode(bytes);
        console.log(`Message on ${message.subject}: ${text}`);
      }
    } else if (message.type === 'error') {
      console.error('Server error:', message.error);
    }
  }

  subscribe(subject) {
    if (this.subscriptions.has(subject)) {
      console.log(`Already subscribed to ${subject}`);
      return;
    }

    const message = {
      type: 'subscribe',
      subject: subject
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.add(subject);
    console.log(`Subscribed to ${subject}`);
  }

  publish(subject, data) {
    // Convert string to number array for compatibility
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    const dataArray = Array.from(bytes);

    const message = {
      type: 'publish',
      subject: subject,
      data: dataArray
    };

    this.ws.send(JSON.stringify(message));
    console.log(`Published to ${subject}: ${data}`);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Test the gateway
async function runTest() {
  const client1 = new TestClient('ws://localhost:8080/ws');
  const client2 = new TestClient('ws://localhost:8080/ws');

  try {
    // Connect both clients
    await client1.connect();
    await client2.connect();

    // Wait a moment for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Client 1 subscribes to test subjects
    client1.subscribe('test.hello');
    client1.subscribe('test.*');
    client1.subscribe('workflow.>');

    // Client 2 subscribes to overlapping subjects
    client2.subscribe('test.hello');
    client2.subscribe('workflow.started');

    // Wait for subscriptions to be established
    await new Promise(resolve => setTimeout(resolve, 100));

    // Test publishing from both clients
    client2.publish('test.hello', 'Hello from client 2!');
    client1.publish('test.goodbye', 'Goodbye from client 1!');
    client1.publish('workflow.started', JSON.stringify({ id: '123', name: 'Test Workflow' }));
    client2.publish('workflow.completed', JSON.stringify({ id: '123', result: 'success' }));

    // Wait for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Test completed successfully!');

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    client1.close();
    client2.close();
  }
}

// Run the test if messagebus-gateway is available
runTest().catch(console.error);