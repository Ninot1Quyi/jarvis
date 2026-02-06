/**
 * Test script for overlay UI connection
 *
 * Usage: npx ts-node src/utils/test-overlay.ts
 */

import { overlayClient } from './overlay.js'

async function main() {
  console.log('Starting overlay test...')

  // Enable overlay client
  overlayClient.enable()

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Send test messages
  overlayClient.sendSystem('Test started')

  await new Promise(resolve => setTimeout(resolve, 500))

  overlayClient.sendUser('Hello, this is a user message')

  await new Promise(resolve => setTimeout(resolve, 500))

  overlayClient.sendAssistant('I received your message. Let me help you with that.', [
    { name: 'click', arguments: { x: 500, y: 300 } }
  ])

  await new Promise(resolve => setTimeout(resolve, 500))

  overlayClient.sendTool('click', 'Clicked at (500, 300)')

  await new Promise(resolve => setTimeout(resolve, 500))

  overlayClient.sendAssistant('The click was successful. What would you like me to do next?')

  await new Promise(resolve => setTimeout(resolve, 500))

  overlayClient.sendError('This is a test error message')

  console.log('Test messages sent. Check the overlay UI.')

  // Keep running for a bit
  await new Promise(resolve => setTimeout(resolve, 5000))

  overlayClient.disable()
  console.log('Test complete.')
  process.exit(0)
}

main().catch(console.error)
