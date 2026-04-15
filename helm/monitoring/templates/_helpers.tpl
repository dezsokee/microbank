{{- define "monitoring.fullname" -}}
{{- .Release.Name }}-monitoring
{{- end -}}

{{- define "monitoring.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
