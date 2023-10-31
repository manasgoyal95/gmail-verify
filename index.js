const express = require("express")
const app = express()
const path = require("path")
const fs = require("fs").promises
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://mail.google.com/',
];

app.get("/", async (req,res) => {
    //Load client secrets from file
    const credentials = await fs.readFile('credentials.json')

    //Authorize a client from credentials then call gmail api
    const auth = await authenticate({
        keyfilePath: path.join(__dirname, 'credentials.json'),
        scopes: SCOPES
    })

    console.log("this is auth: ", auth)

    const gmail = google.gmail({version:'v1', auth})
    const response = await gmail.users.labels.list({
        userId: 'me',

    })

    //name of label that would be created if not present
    const LABEL_NAME = "Vacation"

    //Load credentials from file
    async function loadCredentials(){
        const filePath = path.join(process.cwd(), 'credentias.json')
        const content = await fs.readFile(filePath, {encoding:'utf-8'})
        return JSON.parse(content)
    }

    //Get messages that have no prior replies
    async function getUnrepliedMessages(auth){
        const gmail = google.gmail({version:'v1',auth})
        //quering messages that are unread
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: '-in:chats -from:me -has:userlabels',
        })
        return res.data.messages || []
    }

    //send reply to a message 
    async function sendReply(auth,message){
        const gmail = google.gmail({version:'v1',auth})
        //extracting email id and suject of unread email
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From'],
        })

        const subject = res.data.payload.headers.find(
            (header) => header.name === 'Subject'
        ).value
        const from = res.data.payload.headers.find(
            (header) => header.name === 'From'
        ).value

        //extracting email id
        const replyTo = from.match(/<(.*)>/)[1]
        //creating reply message template
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
        const replyBody = `Hi. \n\nI'm currently on vacation and will get back to you soon.`
        const rawMessage = [
            `From : me`,
            `To : ${replyTo}`,
            `Subject: ${replySubject}`,
            `In-Reply-To: ${message.id}`,
            `References: ${message.id}`,
            '',
            replyBody,
        ].join('\n')

        //encoding message before sending
        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'')

        //sending message
        await gmail.users.messages.send({
            userId:'me',
            requestBody:{
                raw: encodedMessage
            },
        })
    }

    async function createLabel(auth) {
        const gmail = google.gmail({version:'v1',auth})
        try {
            const res = await gmail.users.labels.create({
                userId:"me",
                requestBody:{
                    name: LABEL_NAME,
                    labelListVisibility: 'labelShow',
                    messageListVisibility: 'show'
                }
            })
            return res.data.id
        } 
        catch (error) {
            if(error.code === 409){
                //Label already exist
                const res = await gmail.users.labels.list({
                    userId: 'me',

                })
                const label = res.data.labels.find((label) => label.name === LABEL_NAME)
                return label.id
            }
            else{
                throw error
            }   
        }
    }

    //Add label to the mail and move to label folder
    async function addLabel(auth,message,labelId){
        const gmail = google.gmail({version:'v1',auth})
        await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody:{
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX']
            }
        })
    }

    //main function used for calling all the above functions
    async function main(){
        const labelId = await createLabel(auth)
        console.log(`created or found label at ${labelId}`)
        
        //Repeat in random interval
        setInterval(async () => {
            //gets message that have no prior replies
            const messages = await getUnrepliedMessages(auth)
            console.log(`found ${messages.length} unreplied messages`)

            //for each mssg   
            for(const message of messages){
                //sending reply
                await sendReply(auth, message)
                console.log(`sent reply message with id ${message.id}`)

                //add label
                await addLabel(auth,message, labelId)
                console.log(`added label to message wiht id ${message.id}`)
            }
        }, Math.floor(Math.random() * (120-45+1) + 45)*1000
        )

    }

    main().catch(console.error)

})


app.listen("5000", () => {
    console.log("Server running")
})