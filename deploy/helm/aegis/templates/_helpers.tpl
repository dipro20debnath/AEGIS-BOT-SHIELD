{{- define "aegis.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Name of one component: <fullname>-<component> */}}
{{- define "aegis.name" -}}
{{- printf "%s-%s" (include "aegis.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "aegis.labels" -}}
app.kubernetes.io/name: aegis
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/part-of: aegis-bot-shield
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
{{- end -}}

{{- define "aegis.selectorLabels" -}}
app.kubernetes.io/name: aegis
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "aegis.image" -}}
{{- printf "%s/%s:%s" .root.Values.image.repository .component .root.Values.image.tag -}}
{{- end -}}

{{- define "aegis.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "aegis.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Redis URL for one database */}}
{{- define "aegis.redisUrl" -}}
{{- if .root.Values.redis.enabled -}}
{{- printf "redis://%s:6379/%v" (include "aegis.name" (dict "root" .root "component" "redis")) .db -}}
{{- else if .root.Values.redis.externalUrl -}}
{{- .root.Values.redis.externalUrl -}}
{{- end -}}
{{- end -}}

{{/* Settings shared by the API server containers */}}
{{- define "aegis.commonEnv" -}}
- name: AEGIS_SITE_KEY
  value: {{ .Values.siteKey | quote }}
- name: AEGIS_MODE
  value: {{ .Values.mode | quote }}
- name: AEGIS_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "aegis.secretName" . }}
      key: AEGIS_SECRET_KEY
{{- end -}}

{{- define "aegis.podSpecCommon" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* Pod security context with the image's numeric user (runAsNonRoot needs a numeric UID) */}}
{{- define "aegis.podSecurity" -}}
securityContext:
  {{- toYaml .root.Values.podSecurityContext | nindent 2 }}
  runAsUser: {{ .uid }}
  runAsGroup: {{ .uid }}
  fsGroup: {{ .uid }}
{{- end -}}

{{- define "aegis.prometheusAnnotations" -}}
{{- if .root.Values.metrics.podAnnotations }}
prometheus.io/scrape: "true"
prometheus.io/port: {{ .port | quote }}
prometheus.io/path: "/aegis/metrics"
{{- end }}
{{- end -}}
