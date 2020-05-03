import * as admin from 'firebase-admin'
import { Request, Response } from 'express';
import { generateUuid } from './uuid-generator'

export async function generateAccessToken(req: Request, res: Response) {
    try {
        if (req.method !== 'POST') {
            console.log(`generateAccessToken should be called with the POST method`)
            res.sendStatus(400)
            return
        }
        // TODO: grant_type=client_credentials?
        const authHeader = req.headers.authorization
        if (authHeader === undefined) {
            console.log(`generateAccessToken must be called with an Authorization header`)
            res.sendStatus(400)
            return
        }
        if (authHeader.indexOf('Bearer ') !== 0) {
            console.log(`generateAccessToken Authorization header should be of type Bearer`)
            res.sendStatus(400)
            return
        }
        const authorizationKey = authHeader.slice(7)
        if (authorizationKey.length === 0) {
            console.log(`generateAccessToken Authorization key is empty`)
            res.sendStatus(400)
            return
        }
        console.log(`generateAccessToken found ${authorizationKey} authorization key`)

        const firestore = admin.firestore()
        const responseData = await firestore.runTransaction(async (transaction) => {
            // check if the authorization key exists
            const authorizationKeyDocRef = firestore.collection('authorizationKeys').doc(authorizationKey)
            const authorizationKeyDocSnapshot = await transaction.get(authorizationKeyDocRef)
            if (!authorizationKeyDocSnapshot.exists) {
                console.log(`authorizationKey ${authorizationKey} does not exist in the system`)
                return { statusCode: 400 }
            }
            // find the corresponding user for that authorization key
            const authorizationKeyDocData = authorizationKeyDocSnapshot.data()!
            const uid = authorizationKeyDocData.uid
            const environment = authorizationKeyDocData.environment
            if (uid === undefined || environment === undefined) {
                console.log(`could not find 'uid', 'environment' for authorizationKey ${authorizationKey}`)
                return { statusCode: 500 }
            }
            const userDocRef = admin.firestore().collection('users').doc(uid)
            const userDocSnapshot = await transaction.get(userDocRef)
            if (!userDocSnapshot.exists) {
                console.log(`users/${uid} not found`)
                return { statusCode: 400 }
            }
            // check if there is already an access token for that user
            const data = userDocSnapshot.data()!
            const accessTokenKey = `${environment}AccessToken`
            const accessToken = data[accessTokenKey]
            if (accessToken === undefined) {
                // generate a new access token
                const newAccessToken = generateUuid()
                // write it to `users/$uid`
                const newData = environment === 'sandbox'
                    ? { sandboxAccessToken: newAccessToken }
                    : { productionAccessToken: newAccessToken }
                transaction.set(userDocRef, newData, { merge: true })
                // write it to `accessTokens/$accessToken`
                const accessTokenDocRef = firestore.collection('accessTokens').doc(newAccessToken)
                transaction.set(accessTokenDocRef, {
                    uid: uid,
                    environment: environment
                    // TODO: write expiry date
                }, { merge: true })
                return { statusCode: 200, accessToken: newAccessToken }

            } else {
                // return the existing access token
                // TODO: check if expired
                return { statusCode: 200, accessToken: accessToken }
            }
        });
        if (responseData.statusCode === 200) {
            res.status(200).send({
                'access-token': responseData.accessToken
            })
        } else {
            res.sendStatus(responseData.statusCode)
        }

    } catch (error) {
        console.log(`Error generating access token: `, error);
        res.sendStatus(400)
        throw error;
    }
}
