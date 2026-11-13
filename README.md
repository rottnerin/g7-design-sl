# Design for Service: Meet Your Client

A chat site where Grade 7 design students talk to a simulated client from their
service learning group, work through ACCESS FM, and produce a one-page
specification. Teachers get a password-protected view of every chat and one-pager.

- Student site: `/`. Students type the class code, then their name and section. The chat opens and they introduce themselves and name their service learning group. The site works out the group from what they write and plays a client for it, using that group's page from the service learning handbook.
- Teacher view: `/admin` (browser asks for the shared username and password). The teacher view also sets how imaginative the client is.

## Things you will want to edit

| What | Where |
| --- | --- |
| Service learning groups (text from the school handbook) | `data/handbook.json`, rebuilt with `scripts/build-handbook.py` when a new handbook comes out |
| The design teacher's client list: what each client needs and the hidden idea hints | `data/groups.json` |
| How the client behaves, the friction rules, what counts as buildable, the ACCESS FM questions | `src/prompt.js` |
| Temperature (imagination) and Gemini model | Teacher view, top of the page |
| Colours and fonts | top of `public/style.css` |
| Design sections (7.01, 7.02, …) | `SECTIONS` setting |

## Settings (environment variables)

| Name | Purpose |
| --- | --- |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Shared teacher login. The teacher view is off until both are set. |
| `CLASS_CODE` | Students must type this before they can start a chat. Not case-sensitive. Without it, anyone with the address can start a chat. |
| `STORE=firestore` | Save chats in Firestore. Without it, chats go to a local file (lost on Cloud Run restarts). |
| `SECTIONS` | Comma-separated list, default `7.01,7.02,7.03,7.04,7.05,7.06`. |
| `GEMINI_MODEL`, `GEMINI_TEMPERATURE` | Starting values, default `gemini-3.8-flash` and `1`. Once saved in the teacher view, the saved values win. |
| `GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Use Gemini through the Google Cloud project (no API key). |
| `GOOGLE_API_KEY` | Alternative: use a Gemini API key. |
| `MOCK_AI=1` | Canned replies, no Gemini. For trying the site only. |

## Run on your own computer

```bash
npm install
```

```bash
npm run dev
```

Opens on http://localhost:8080 in test mode (canned replies, class code `test`, teacher login `teacher` / `test`).

To use real Gemini locally, put your key after `GOOGLE_API_KEY=` in the `.env` file and run this instead:

```bash
npm start
```

`.env` also holds the local class code and teacher login. It is never uploaded to GitHub.

## Deploy to Cloud Run

Replace `PROJECT_ID`, and pick your own teacher password and class code. `asia-southeast1` is Singapore.

```bash
gcloud config set project PROJECT_ID
```

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com aiplatform.googleapis.com
```

```bash
gcloud firestore databases create --location=asia-southeast1
```

Let the Cloud Run service account use Firestore and Gemini:

```bash
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
for ROLE in roles/datastore.user roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role="$ROLE"
done
```

Deploy:

```bash
gcloud run deploy service-design-bot --source . --region asia-southeast1 --allow-unauthenticated \
  --set-env-vars "STORE=firestore,GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_PROJECT=PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,ADMIN_USER=teacher,ADMIN_PASSWORD=CHOOSE_A_PASSWORD,CLASS_CODE=CHOOSE_A_CLASS_CODE"
```

The command prints the site URL when it finishes.

To use an API key instead of the project's own Gemini access, drop the three
`GOOGLE_...` settings above and add `GOOGLE_API_KEY=your-key` (better: store it
in Secret Manager and use `--set-secrets GOOGLE_API_KEY=name:latest`).

## Not built yet

- Export into the Google Doc template (the one-pager currently prints / saves as PDF from the browser).
- Returning on a different computer. A student can continue only in the same browser.
- Individual teacher accounts.
