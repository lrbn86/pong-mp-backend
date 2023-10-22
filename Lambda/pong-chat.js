import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';

export const handler = async (event) => {
    const eventType = event.requestContext.eventType;
    const connectionId = event.requestContext.connectionId;
    const domainName = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    const connectionsURL = `https://${domainName}/${stage}`;
    const apiGatewayClient = new ApiGatewayManagementApiClient({ endpoint: connectionsURL });
    const dynamoDBClient = new DynamoDBClient({ region: 'us-east-2' });

    const params = { connectionId: connectionId, apiGatewayClient: apiGatewayClient, dynamoDBClient: dynamoDBClient };

    switch (eventType) {
        case 'CONNECT':
            return await handleConnection(params);
        case 'DISCONNECT':
            return await handleDisconnection(params);
        case 'MESSAGE':
            return await handleMessage(event, params);
        default:
            break;
    }
};

async function handleConnection({ connectionId, apiGatewayClient, dynamoDBClient }) {
    try {
        const params = { TableName: 'WebSocketConnections', Item: { connectionId: { S: connectionId } } };
        await dynamoDBClient.send(new PutItemCommand(params));
        return { statusCode: 200, body: 'Connected' };
    } catch (error) {
        console.error('Error storing connectionId to DynamoDB:', error.toString());
        return { statusCode: 500, body: 'Error connecting.' };
    }
}

async function handleDisconnection({ connectionId, apiGatewayClient, dynamoDBClient }) {
    try {
        const params = { TableName: 'WebSocketConnections', Key: { connectionId: { S: connectionId } } };
        await dynamoDBClient.send(new DeleteItemCommand(params));
        return { statusCode: 200, body: 'Disconnected' };
    } catch (error) {
        console.error('Error deleting connectionId from DynamoDB:', error.toString());
        return { statusCode: 500, body: 'Error disconnecting.' };
    }
}

async function handleMessage(event, { connectionId, apiGatewayClient, dynamoDBClient }) {
    try {
        const routeKey = event.requestContext.routeKey;
        const params = { TableName: 'WebSocketConnections' };
        const data = await dynamoDBClient.send(new ScanCommand(params));
        const connections = data.Items.map(item => item.connectionId.S);

        if (routeKey === 'SendMessage') {
            // Send the message to all active connections
            const postPromises = connections.map(async (connectionId) => {
                try {
                    const requestParams = { ConnectionId: connectionId, Data: JSON.parse(event.body).data };
                    const command = new PostToConnectionCommand(requestParams);
                    await apiGatewayClient.send(command);
                } catch (error) {
                    console.error(`Error sending message to connection ${connectionId}: ${error.toString()}`);
                    return { statusCode: 500, body: `Error sending message to connection ${connectionId}: ${error.toString()}` };
                }
            });
            // Wait for all messages to be sent before responding
            await Promise.all(postPromises);
            return { statusCode: 200, body: 'Sent message to all connections' };
        } else if (routeKey === 'GetSodium') {
            return { statusCode: 200, body: 'Sent get sodium' };
        }
    } catch (error) {
        console.error('Error sending message', error.toString());
        return { statusCode: 500, body: `Error sending message: ${error.toString()}` };
    }
}

/**
 * Remember to re-deploy API Gateway when adding a different route when checking for action/routeKey
 * The service role needs to have:
 * AmazonAPIGatewayInvokeFullAccess
 * AmazonAPIGatewayPushToCloudWatchLogs
 * AmazonDynamoDBFullAccess
 * AWSLambdaRole
 */
