/**
 * Connection Test Script for LearnByAi Platform
 * Run with: bun test-connections.mjs
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testSupabase() {
  log('\n📊 Testing Supabase Connection...', colors.blue);
  
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test connection by querying users table
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      throw error;
    }

    log('✅ Supabase connection successful!', colors.green);
    log(`   URL: ${supabaseUrl}`, colors.green);
    log(`   Tables accessible: users`, colors.green);
    
    return true;
  } catch (error) {
    log('❌ Supabase connection failed!', colors.red);
    log(`   Error: ${error.message}`, colors.red);
    return false;
  }
}

async function testMongoDB() {
  log('\n🍃 Testing MongoDB Connection...', colors.blue);
  
  let client = null;
  
  try {
    const mongoUri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME;
    const directConnection = process.env.MONGODB_DIRECT_CONNECTION === 'true';

    if (!mongoUri) {
      throw new Error('Missing MongoDB URI');
    }

    // Extract host info for display (hide credentials)
    const hostInfo = mongoUri.includes('@') ? mongoUri.split('@')[1] : 'MongoDB';
    log(`   Connecting to: ${hostInfo}`, colors.yellow);
    if (directConnection) {
      log('   Using direct connection mode', colors.yellow);
    }

    // Connection options for self-hosted MongoDB
    const options = {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      directConnection: directConnection,
    };

    client = new MongoClient(mongoUri, options);
    await client.connect();

    const db = client.db(dbName || 'learnbyai_platform');
    
    // Test connection
    await db.admin().ping();

    // List collections
    const collections = await db.listCollections().toArray();
    
    log('✅ MongoDB connection successful!', colors.green);
    log(`   Database: ${dbName || 'learnbyai_platform'}`, colors.green);
    log(`   Collections: ${collections.length > 0 ? collections.map(c => c.name).join(', ') : 'None (will be created automatically)'}`, colors.green);
    
    return true;
  } catch (error) {
    log('❌ MongoDB connection failed!', colors.red);
    log(`   Error: ${error.message}`, colors.red);
    
    // Check for common issues (updated for self-hosted MongoDB)
    if (error.message.includes('Authentication failed')) {
      log('\n💡 Tip: Check your MongoDB username and password', colors.yellow);
      log('   Make sure special characters in password are URL encoded', colors.yellow);
      log('   Example: @ should be %40, # should be %23', colors.yellow);
    } else if (error.message.includes('ENOTFOUND')) {
      log('\n💡 Tip: Cannot resolve MongoDB host', colors.yellow);
      log('   Check the hostname/IP address in your connection string', colors.yellow);
      log('   For EC2: Use public IP or DNS name', colors.yellow);
    } else if (error.message.includes('ECONNREFUSED')) {
      log('\n💡 Tip: Connection refused', colors.yellow);
      log('   1. Check if MongoDB is running: sudo systemctl status mongod', colors.yellow);
      log('   2. Check if MongoDB is listening on the correct port (default: 27017)', colors.yellow);
      log('   3. Check firewall rules on EC2 security group', colors.yellow);
    } else if (error.message.includes('ETIMEDOUT')) {
      log('\n💡 Tip: Connection timeout', colors.yellow);
      log('   1. Check EC2 security group allows inbound on port 27017', colors.yellow);
      log('   2. Check MongoDB bind_ip in /etc/mongod.conf (should be 0.0.0.0 for remote access)', colors.yellow);
      log('   3. Check if UFW firewall is blocking: sudo ufw status', colors.yellow);
    } else if (error.message.includes('IP')) {
      log('\n💡 Tip: IP whitelist issue', colors.yellow);
      log('   For self-hosted MongoDB, check firewall rules instead of IP whitelist', colors.yellow);
    }
    
    return false;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

async function testQdrant() {
  log('\n🔷 Testing Qdrant Connection...', colors.blue);
  
  try {
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    const collectionName = process.env.QDRANT_COLLECTION_NAME || 'LearnByAI';

    log(`   Connecting to: ${qdrantUrl}`, colors.yellow);
    log(`   Collection: ${collectionName}`, colors.yellow);

    const qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey || undefined,
    });

    // Test connection by listing collections
    const collections = await qdrant.getCollections();
    
    log('✅ Qdrant connection successful!', colors.green);
    log(`   URL: ${qdrantUrl}`, colors.green);
    log(`   Available collections: ${collections.collections?.map(c => c.name).join(', ') || 'None'}`, colors.green);

    // Check if our collection exists
    const collectionExists = collections.collections?.some(c => c.name === collectionName);
    
    if (collectionExists) {
      log(`   ✓ Collection "${collectionName}" exists`, colors.green);
      
      // Get collection info
      const info = await qdrant.getCollection(collectionName);
      log(`   Points in collection: ${info.points_count || 0}`, colors.green);
      log(`   Vectors count: ${info.vectors_count || 0}`, colors.green);
      log(`   Vector size: ${info.config?.params?.vectors?.size || 'N/A'}`, colors.green);
      log(`   Distance metric: ${info.config?.params?.vectors?.distance || 'N/A'}`, colors.green);
    } else {
      log(`   ⚠️  Collection "${collectionName}" not found`, colors.yellow);
      log('   The collection will be created automatically on first vector upload', colors.yellow);
      log('   Recommended settings:', colors.yellow);
      log('   - Dimensions: 3072 (for text-embedding-3-large)', colors.yellow);
      log('   - Distance: Cosine', colors.yellow);
    }
    
    return true;
  } catch (error) {
    log('❌ Qdrant connection failed!', colors.red);
    log(`   Error: ${error.message}`, colors.red);
    
    if (error.message.includes('ECONNREFUSED')) {
      log('\n💡 Tip: Qdrant server is not running or not accessible', colors.yellow);
      log('   1. Check if Qdrant is running on EC2', colors.yellow);
      log('   2. Verify EC2 security group allows inbound on port 6333', colors.yellow);
      log('   3. Check firewall rules', colors.yellow);
    } else if (error.message.includes('ETIMEDOUT')) {
      log('\n💡 Tip: Connection timeout', colors.yellow);
      log('   1. Check EC2 security group allows inbound on port 6333', colors.yellow);
      log('   2. Verify Qdrant is listening on 0.0.0.0', colors.yellow);
      log('   3. Check network connectivity', colors.yellow);
    } else if (error.message.includes('ENOTFOUND')) {
      log('\n💡 Tip: Cannot resolve Qdrant host', colors.yellow);
      log('   Check the QDRANT_URL in your .env.local file', colors.yellow);
    }
    
    return false;
  }
}

async function runAllTests() {
  log('═══════════════════════════════════════════════', colors.blue);
  log('  LearnByAi Platform - Connection Test', colors.blue);
  log('═══════════════════════════════════════════════', colors.blue);

  const results = {
    supabase: false,
    mongodb: false,
    qdrant: false,
  };

  results.supabase = await testSupabase();
  results.mongodb = await testMongoDB();
  results.qdrant = await testQdrant();

  log('\n═══════════════════════════════════════════════', colors.blue);
  log('  Summary', colors.blue);
  log('═══════════════════════════════════════════════', colors.blue);

  const total = Object.values(results).filter(Boolean).length;
  const allPassed = total === 3;

  log(`\nSupabase (PostgreSQL): ${results.supabase ? '✅ Connected' : '❌ Failed'}`, results.supabase ? colors.green : colors.red);
  log(`MongoDB: ${results.mongodb ? '✅ Connected' : '❌ Failed'}`, results.mongodb ? colors.green : colors.red);
  log(`Qdrant (Vector DB): ${results.qdrant ? '✅ Connected' : '❌ Failed'}`, results.qdrant ? colors.green : colors.red);

  log(`\nResult: ${total}/3 connections successful\n`, allPassed ? colors.green : colors.yellow);

  if (allPassed) {
    log('🎉 All database connections are working!', colors.green);
    log('You can now proceed with development.\n', colors.green);
  } else {
    log('⚠️  Some connections failed. Please fix them before proceeding.\n', colors.yellow);
    log('Common fixes:', colors.yellow);
    log('1. MongoDB: URL encode special characters in password', colors.yellow);
    log('2. Qdrant: Check EC2 security group allows port 6333', colors.yellow);
    log('3. Supabase: Make sure SQL schema has been executed\n', colors.yellow);
  }

  process.exit(allPassed ? 0 : 1);
}

// Run tests
runAllTests().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, colors.red);
  process.exit(1);
});
