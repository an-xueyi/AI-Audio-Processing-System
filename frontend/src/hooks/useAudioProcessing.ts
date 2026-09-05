/*
 * Coordinate the complete user workflow: initialize a session, select a file,
 * upload it directly, create a Kafka-backed job, receive live status, cancel
 * work, and request result links. Components consume this hook as one clear API.
 */
import { useState } from "react";
import {
  cancelProcessingJob,
  createProcessingJob,
  requestPresignedUpload,
  uploadAudioFile,
} from "../api/audioProcessing";
import { getAudioContentType } from "../utils/audio";
import { isActiveJob } from "../utils/jobs";
import { useApplicationInitialization } from "./useApplicationInitialization";
import { useAuthentication } from "./useAuthentication";
import { useJobHistory } from "./useJobHistory";
import { useSelectedJob } from "./useSelectedJob";
import { useWorkerAvailability } from "./useWorkerAvailability";

export function useAudioProcessing() {
  // useState stores values between React renders. Each setter schedules another
  // render so the visible interface reflects the new application state.
  // null means the user has not selected a browser File yet.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // message is shared by status and upload sections as human-readable feedback.
  const [message, setMessage] = useState("Checking backend...");

  // Boolean flags disable commands while their asynchronous operation is active.
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const {
    isJobHistoryLoading,
    jobHistory,
    loadJobHistory,
    upsertHistoryJob,
  } = useJobHistory();

  const { clearSelectedJob, downloadUrls, job, selectJob } = useSelectedJob({
    onStatusMessage: setMessage,
    upsertHistoryJob,
  });

  const authentication = useAuthentication();
  const { backendHealth, sessionReady } = useApplicationInitialization({
    loadAuthentication: authentication.loadAuthentication,
    loadJobHistory,
    selectJob,
    setMessage,
  });
  // Worker availability is independent of the selected job. Polling continues
  // while the page is open so a local hybrid worker can appear or disappear.
  const workerAvailability = useWorkerAvailability(backendHealth !== null);

  async function reloadJobsAfterIdentityChange(successMessage: string) {
    // A WebSocket authenticated before login still represents the former owner.
    // Clearing selection closes it before history is loaded for the new owner.
    clearSelectedJob();

    try {
      const jobs = await loadJobHistory();
      const activeJob = jobs.find(isActiveJob);

      if (activeJob) {
        selectJob(activeJob);
        setMessage(
          `Recovered ${activeJob.original_file_name} at ${activeJob.progress}%.`,
        );
      } else {
        setMessage(successMessage);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account changed, but job history could not be loaded.",
      );
    }
  }

  async function login(username: string, password: string) {
    const succeeded = await authentication.login(username, password);

    if (succeeded) {
      await reloadJobsAfterIdentityChange(
        `Signed in as ${username.toLowerCase()}.`,
      );
    }

    return succeeded;
  }

  async function register(username: string, password: string) {
    const succeeded = await authentication.register(username, password);

    if (succeeded) {
      await reloadJobsAfterIdentityChange(
        `Account ${username.toLowerCase()} was created.`,
      );
    }

    return succeeded;
  }

  async function logout() {
    const succeeded = await authentication.logout();

    if (succeeded) {
      await reloadJobsAfterIdentityChange(
        "Signed out. This browser now has a private visitor workspace.",
      );
    }

    return succeeded;
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string,
  ) {
    const succeeded = await authentication.changePassword(
      currentPassword,
      newPassword,
    );

    if (succeeded) {
      setMessage("Password changed. Other browsers were signed out.");
    }

    return succeeded;
  }

  async function revokeOtherSessions() {
    const succeeded = await authentication.revokeOtherSessions();

    if (succeeded) {
      setMessage("Other browser sessions were signed out.");
    }

    return succeeded;
  }

  async function deleteAccount(password: string) {
    const succeeded = await authentication.deleteAccount(password);

    if (succeeded) {
      await reloadJobsAfterIdentityChange(
        "Account deleted. This browser now has a private visitor workspace.",
      );
    }

    return succeeded;
  }

  function selectFile(file: File | null) {
    // Selecting another file resets every result belonging to the previous job
    // and closes its realtime subscription.
    clearSelectedJob();
    // Store the new File object or null if the browser input was cleared.
    setSelectedFile(file);
    // The ternary chooses a message based on whether a File currently exists.
    setMessage(
      file ? `Selected file: ${file.name}` : "Please choose an audio file",
    );
  }

  async function startProcessing() {
    // Guard clauses stop early and keep the main success path less deeply nested.
    if (!selectedFile) {
      setMessage("Please choose an audio file first.");
      return;
    }

    if (!sessionReady) {
      setMessage("The secure browser session is not ready.");
      return;
    }

    // Determine the MIME type needed in both presign and direct PUT requests.
    const contentType = getAudioContentType(selectedFile);

    // An empty type means neither browser metadata nor extension fallback worked.
    if (!contentType) {
      setMessage("Could not determine the selected file's audio type.");
      return;
    }

    try {
      setIsUploading(true);
      // Step 1: ask the backend for temporary, narrowly scoped upload permission.
      setMessage("Requesting presigned URL...");
      const presignData = await requestPresignedUpload(
        selectedFile,
        contentType,
      );

      // Step 2: send the large audio bytes directly to object storage.
      setMessage("Uploading file to object storage...");
      await uploadAudioFile(presignData.uploadUrl, selectedFile, contentType);

      // Step 3: create a small database job that references the stored object.
      setMessage("Creating processing job...");
      const createdJob = await createProcessingJob(
        selectedFile.name,
        presignData.objectKey,
      );

      // Make the new job current and add it to the beginning of visible history.
      // Step 4: show the job, add history, and watch WebSocket updates.
      selectJob(createdJob);
      setMessage("Job created. The worker will process it in the background.");
    } catch (error) {
      // All three network stages report through one user-visible error path.
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      // finally runs after success or failure, ensuring the button is re-enabled.
      setIsUploading(false);
    }
  }

  async function cancelJob() {
    // Ignore cancellation when no job exists or a previous click is still pending.
    if (!job || isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      setMessage("Cancelling job processing...");
      const cancelledJob = await cancelProcessingJob(job.id);
      // Use the database response as authoritative detail and history state.
      selectJob(cancelledJob);
      setMessage("Job processing was cancelled.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to cancel job.",
      );
    } finally {
      // Re-enable the button even if the cancellation request failed.
      setIsCancelling(false);
    }
  }

  // Expose state for rendering and named actions for user events. Internal setter
  // functions and workflow details remain private to this hook.
  return {
    accountManagementError: authentication.accountManagementError,
    accountSessions: authentication.accountSessions,
    authenticationError: authentication.authenticationError,
    backendHealth,
    cancelJob,
    changePassword,
    currentUser: authentication.currentUser,
    deleteAccount,
    downloadUrls,
    isAuthenticating: authentication.isAuthenticating,
    isCancelling,
    isJobHistoryLoading,
    isManagingAccount: authentication.isManagingAccount,
    isUploading,
    job,
    jobHistory,
    login,
    loadAccountSessions: authentication.loadAccountSessions,
    logout,
    message,
    register,
    revokeOtherSessions,
    selectedFile,
    sessionReady,
    selectFile,
    selectHistoryJob: selectJob,
    startProcessing,
    workerAvailability,
  };
}
