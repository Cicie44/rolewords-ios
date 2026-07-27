import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createInterviewDraft,
  updateInterviewDraft,
  uploadInterviewCv,
} from '@/src/services/interviewService';
import type { CreateInterviewDraftInput } from '@/src/types/interview';

type PickedFile = {
  uri: string;
  name: string;
};

export default function InterviewScreen() {
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const trimmedJobTitle = jobTitle.trim();
  const trimmedCompanyName = companyName.trim();
  const canSubmit =
    trimmedJobTitle.length > 0 &&
    trimmedCompanyName.length > 0 &&
    pickedFile !== null &&
    !isSubmitting;

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setPickedFile({ uri: asset.uri, name: asset.name });
      setErrorMessage(null);
    } catch {
      setErrorMessage('无法选择 PDF 文件，请重试。');
    }
  };

  const resetForm = () => {
    setJobTitle('');
    setCompanyName('');
    setJobDescription('');
    setPickedFile(null);
    setDraftId(null);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) {
      return;
    }

    if (!canSubmit || !pickedFile) {
      return;
    }

    const trimmedJobDescription = jobDescription.trim();
    const normalizedInput: CreateInterviewDraftInput = {
      jobTitle: trimmedJobTitle,
      companyName: trimmedCompanyName,
      jobDescription: trimmedJobDescription.length > 0 ? trimmedJobDescription : undefined,
    };

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      let interviewSessionId = draftId;

      if (!interviewSessionId) {
        const draft = await createInterviewDraft(normalizedInput);
        interviewSessionId = draft.id;
        setDraftId(draft.id);
      } else {
        // Uploading may fail after this point, so re-sync the draft with
        // whatever the user has edited since the previous attempt before
        // attaching the CV to it.
        await updateInterviewDraft(interviewSessionId, normalizedInput);
      }

      const fileResponse = await fetch(pickedFile.uri);
      const data = await fileResponse.arrayBuffer();

      await uploadInterviewCv({
        interviewSessionId,
        fileName: pickedFile.name,
        data,
      });

      resetForm();

      router.push({
        pathname: '/interview/[id]',
        params: {
          id: interviewSessionId,
          jobTitle: normalizedInput.jobTitle,
          companyName: normalizedInput.companyName,
        },
      });
    } catch {
      setErrorMessage('提交失败，请重试。');
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>岗位名称</Text>
          <TextInput
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="例如：iOS Developer"
            placeholderTextColor="#999"
            editable={!isSubmitting}
            accessibilityLabel="岗位名称"
            style={styles.input}
          />

          <Text style={styles.label}>公司名称</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="例如：ACME Inc."
            placeholderTextColor="#999"
            editable={!isSubmitting}
            accessibilityLabel="公司名称"
            style={styles.input}
          />

          <Text style={styles.label}>Job Description（选填）</Text>
          <TextInput
            value={jobDescription}
            onChangeText={setJobDescription}
            placeholder="粘贴职位描述（可选）"
            placeholderTextColor="#999"
            multiline
            editable={!isSubmitting}
            accessibilityLabel="Job Description"
            style={[styles.input, styles.multilineInput]}
          />

          <Text style={styles.label}>简历 CV（PDF）</Text>
          {pickedFile ? (
            <View style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>
                {pickedFile.name}
              </Text>
              <Pressable
                onPress={handlePickFile}
                disabled={isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="重新选择 PDF"
                hitSlop={8}
                style={styles.fileChangeButton}>
                <Text style={styles.fileChangeButtonText}>重新选择</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handlePickFile}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="选择 PDF 简历"
              style={styles.pickButton}>
              <Text style={styles.pickButtonText}>选择 PDF 文件</Text>
            </Pressable>
          )}

          {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="创建面试准备"
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}>
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>创建面试准备</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  scrollContent: {
    padding: 16,
    paddingTop: 14,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  label: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 12,
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000',
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
    borderRadius: 10,
    paddingHorizontal: 14,
    gap: 12,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
    color: '#000',
  },
  fileChangeButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  fileChangeButtonText: {
    fontSize: 15,
    color: '#2f95dc',
    fontWeight: '600',
  },
  pickButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: {
    fontSize: 16,
    color: '#2f95dc',
    fontWeight: '600',
  },
  error: {
    fontSize: 13,
    color: '#d9534f',
    marginTop: 8,
  },
  submitButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
