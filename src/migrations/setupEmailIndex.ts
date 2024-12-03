//@ts-ignore
const { PrismaClient } = require('@prisma/client');
//@ts-ignore
const { MongoClient } = require('mongodb');

async function setupEmailIndex() {
  const prisma = new PrismaClient();
  
  try {
    // Get the MongoDB connection URL from Prisma
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Connect directly to MongoDB
    const mongoClient = new MongoClient(databaseUrl);
    await mongoClient.connect();

    const db = mongoClient.db();
    const userCollection = db.collection('User');

    // Drop existing email index if it exists
    try {
      await userCollection.dropIndex('email_1');
    } catch (error) {
      // Index might not exist, continue
    }

    // Update all documents to add hasEmail field
    await userCollection.updateMany(
      { email: { $ne: null } },
      [
        {
          $set: {
            hasEmail: true
          }
        }
      ]
    );

    await userCollection.updateMany(
      { email: null },
      [
        {
          $set: {
            hasEmail: false
          }
        }
      ]
    );

    // Create compound index on hasEmail and email
    await userCollection.createIndex(
      { hasEmail: 1, email: 1 },
      { 
        unique: true,
        partialFilterExpression: {
          hasEmail: true
        }
      }
    );

    console.log('Successfully created email uniqueness index');

    // Close connections
    await mongoClient.close();
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error setting up email index:', error);
    process.exit(1);
  }
}

// Run the migration
setupEmailIndex();