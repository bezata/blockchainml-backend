//@ts-ignore
const { PrismaClient } = require('@prisma/client');
//@ts-ignore
const { MongoClient } = require('mongodb');

async function checkDuplicateEmails() {
  const prisma = new PrismaClient();
  
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const mongoClient = new MongoClient(databaseUrl);
    await mongoClient.connect();

    const db = mongoClient.db();
    const userCollection = db.collection('User');
    const duplicateEmails = await userCollection.aggregate([
      {
        $match: {
          email: { $ne: null }
        }
      },
      {
        $group: {
          _id: "$email",
          count: { $sum: 1 },
          users: { $push: { id: "$_id", walletAddress: "$walletAddress" } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();

    if (duplicateEmails.length > 0) {
      console.log('Found duplicate emails:');
      console.log(JSON.stringify(duplicateEmails, null, 2));
    } else {
      console.log('No duplicate non-null emails found');
    }
    await mongoClient.close();
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error checking duplicate emails:', error);
    process.exit(1);
  }
}

// Run the check
checkDuplicateEmails();
