import express from "express"
import { userMiddleware } from "../middleware.js";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import s3Client from "../storageClient/s3Client.js";
import prismaClient from "../databaseClient/prismaClient.js";
import jwt from "jsonwebtoken"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import config from "../config/index.js";
import { createTaskInput } from "../types.js";

const router = express.Router()


router.post("/signin", async (req, res) => {
    const { publicKey, signature } = req.body;
    // const message = new TextEncoder().encode("Sign into mechanical turks");

    // const result = nacl.sign.detached.verify(
    //     message,
    //     new Uint8Array(signature.data),
    //     new PublicKey(publicKey).toBytes(),
    // );


    // if (!result) {
    //     return res.status(411).json({
    //         message: "Incorrect signature"
    //     })
    // }
    console.log(`Sign in user with ${publicKey}`)
    const existingUser = await prismaClient.user.findFirst({
        where: {
            address: publicKey
        }
    })

    if (existingUser) {
        console.log("user exists");
        const token = jwt.sign({
            userId: existingUser.id
        }, config.jwt.secret)

        res.json({
            token
        })
    } else {
        console.log("create new user");
        const user = await prismaClient.user.create({
            data: {
                address: publicKey,
            }
        })

        const token = jwt.sign({
            userId: user.id
        }, config.jwt.secret)

        res.json({
            token
        })
    }
});
router.get("/presignedUrl", userMiddleware, async (req, res) => {

    try {
        const userId = req.userId;

        const { url, fields } = await createPresignedPost(s3Client, {
            Bucket: config.aws.bucket ?? "",
            Key: `web3_annotate_s3/${userId}/${Math.random()}.jpg`,
            Conditions: [
                ['content-length-range', 0, 5 * 1024 * 1024] // 5 MB max
            ],
            Expires: 3600
        })
        console.log({ url, fields });
        res.json({
            preSignedUrl: url,
            fields
        })
    } catch (err) {
        console.error(`Exception in presignedUrl ${err.message}`)
        console.error(err)
        res.status(500).json({
            message: err.message
        })
    }

})

router.get("/presignedUrlPut", userMiddleware, async (req, res) => {

    const userId = req.userId;


    const command = new PutObjectCommand({
        Bucket: config.aws.bucket ?? "",
        Key: `web3_annotate_s3/${userId}/${Math.random()}.jpg`
    })

    const preSignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600
    })

    console.log(preSignedUrl)

    res.json({
        preSignedUrl: preSignedUrl
    })

})

router.post("/task", userMiddleware, async (req, res) => {

    try {


        const userId = req.userId
        // validate the inputs from the user;
        const body = req.body;

        const parseData = createTaskInput.safeParse(body);

        if (!parseData.success) {
            return res.status(411).json({
                message: "You've sent the wrong inputs"
            })
        }

        let response = await prismaClient.$transaction(async tx => {

            const response = await tx.task.create({
                data: {
                    title: parseData.data.title,
                    amount: parseData.data.amount * config.token.currencyPrecision,
                    signature: parseData.data.signature,
                    user_id: userId
                }
            });

            await tx.option.createMany({
                data: parseData.data.options.map(x => ({
                    image_url: x.imageUrl,
                    task_id: response.id
                }))
            })

            return response;

        })

        res.json({
            id: response.id
        })
    } catch (err) {
        console.error(`Exception in creating task ${err.message}`)
        console.error(err)
        res.status(500).json({
            message: err.message
        })
    }

})


router.get("/task", userMiddleware, async (req, res) => {
    const taskId = req.query.taskId;
    const userId = req.userId;

    const taskDetails = await prismaClient.task.findFirst({
        where: {
            user_id: Number(userId),
            id: Number(taskId)
        },
        include: {
            options: true
        }
    })

    if (!taskDetails) {
        return res.status(411).json({
            message: "You dont have access to this task"
        })
    }

    const submissionDetails = await prismaClient.submission.findMany({
        where: {
            task_id: Number(taskId)
        },
        include: {
            option: true
        }
    });

    const result = {};

    taskDetails.options.forEach(option => {
        result[option.id] = {
            count: 0,
            option: {
                imageUrl: option.image_url
            }
        }
    })

    submissionDetails.forEach(r => {
        result[r.option_id].count++;
    });

    res.json({
        result,
        taskDetails
    })

})
export default router