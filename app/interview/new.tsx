import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
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

const COLORS = {
  background: '#F6F3EE',
  surface: '#FFFFFF',
  ink: '#1E362F',
  inkSoft: '#4B6358',
  accent: '#48715F',
  accentSoft: '#E4EEE8',
  warm: '#B9814F',
  warmDark: '#8C5C2E',
  warmSoft: '#F5E9DA',
  gray: '#66666A',
  grayTrack: '#EDEAE4',
  border: '#E2DED7',
  danger: '#B3483F',
  dangerSoft: '#F7E8E6',
};

type PickedFile = {
  uri: string;
  name: string;
};

export default function NewInterviewScreen() {
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

      // replace (not push): the new-session form should be gone from the
      // stack once it succeeds, so the back button from the detail screen
      // returns to the "面试" tab's history list, not to a cleared form.
      router.replace({
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
          <Text style={styles.sectionTitle}>岗位信息</Text>

          <Text style={styles.label}>岗位名称</Text>
          <TextInput
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="例如：iOS Developer"
            placeholderTextColor={COLORS.gray}
            editable={!isSubmitting}
            accessibilityLabel="岗位名称"
            style={styles.input}
          />

          <Text style={styles.label}>公司名称</Text>
          <TextInput
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="例如：ACME Inc."
            placeholderTextColor={COLORS.gray}
            editable={!isSubmitting}
            accessibilityLabel="公司名称"
            style={styles.input}
          />

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>Job Description（选填）</Text>
          <TextInput
            value={jobDescription}
            onChangeText={setJobDescription}
            placeholder="粘贴职位描述（可选）"
            placeholderTextColor={COLORS.gray}
            multiline
            editable={!isSubmitting}
            accessibilityLabel="Job Description"
            style={[styles.input, styles.multilineInput]}
          />

          <View style={styles.sectionDivider} />
          <Text style={styles.sectionTitle}>简历 CV</Text>
          {pickedFile ? (
            <View style={styles.fileRow}>
              <SymbolView
                name={{ ios: 'doc.fill', android: 'description', web: 'description' }}
                tintColor={COLORS.accent}
                size={20}
              />
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
              <SymbolView
                name={{ ios: 'doc.badge.plus', android: 'note_add', web: 'note_add' }}
                tintColor={COLORS.accent}
                size={22}
              />
              <Text style={styles.pickButtonText}>选择 PDF 文件</Text>
            </Pressable>
          )}
          <Text style={styles.privacyNote}>CV 仅用于本次面试问题和参考答案生成。</Text>

          {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="创建面试准备"
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}>
            {isSubmitting ? (
              <ActivityIndicator color={COLORS.surface} />
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
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 14,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 18,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.ink,
    marginBottom: 2,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginTop: 14,
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    color: COLORS.inkSoft,
    marginTop: 12,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.ink,
  },
  multilineInput: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  fileName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.ink,
  },
  fileChangeButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  fileChangeButtonText: {
    fontSize: 15,
    color: COLORS.accent,
    fontWeight: '600',
  },
  pickButton: {
    flexDirection: 'row',
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pickButtonText: {
    fontSize: 16,
    color: COLORS.accent,
    fontWeight: '600',
  },
  privacyNote: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 6,
  },
  error: {
    fontSize: 13,
    color: COLORS.danger,
    marginTop: 8,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: COLORS.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
