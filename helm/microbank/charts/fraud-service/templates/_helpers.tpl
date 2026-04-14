{{- define "fraud-service.fullname" -}}
{{- printf "%s-fraud-service" .Release.Name -}}
{{- end -}}

{{- define "fraud-service.labels" -}}
app.kubernetes.io/name: fraud-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "fraud-service.selectorLabels" -}}
app.kubernetes.io/name: fraud-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
