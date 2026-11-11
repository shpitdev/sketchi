/**
 * Search names for vendor icon sets beyond the names their vendors give.
 *
 * The best-known AWS services are called by either vendor prefix ("AWS S3",
 * "Amazon S3") and by the bare product ("S3", "DynamoDB"). Only bare names that
 * are unmistakably AWS are listed: "IAM", "KMS", "VPC" and "WAF" also name other
 * clouds' products, and English words ("Batch", "Shield") never are.
 */

/** Bare names by AWS service slug. */
const AWS_BARE_NAMES: Readonly<Record<string, readonly string[]>> = {
	"amazon-athena": ["Athena"],
	"amazon-aurora": ["Aurora"],
	"amazon-cloudfront": ["CloudFront"],
	"amazon-cloudwatch": ["CloudWatch"],
	"amazon-cognito": ["Cognito"],
	"amazon-documentdb": ["DocumentDB"],
	"amazon-dynamodb": ["DynamoDB"],
	"amazon-ebs": ["EBS"],
	"amazon-ec2": ["EC2"],
	"amazon-ecr": ["ECR"],
	"amazon-ecs": ["ECS"],
	"amazon-efs": ["EFS"],
	"amazon-eks": ["EKS"],
	"amazon-elasticache": ["ElastiCache"],
	"amazon-emr": ["EMR"],
	"amazon-eventbridge": ["EventBridge"],
	"amazon-guardduty": ["GuardDuty"],
	"amazon-keyspaces": ["Keyspaces"],
	"amazon-kinesis": ["Kinesis"],
	"amazon-kinesis-data-streams": ["Kinesis Data Streams"],
	"amazon-lightsail": ["Lightsail"],
	"amazon-memorydb": ["MemoryDB"],
	"amazon-msk": ["MSK"],
	"amazon-mwaa": ["MWAA"],
	"amazon-neptune": ["Neptune"],
	"amazon-opensearch-service": ["OpenSearch Service"],
	"amazon-rds": ["RDS"],
	"amazon-redshift": ["Redshift"],
	"amazon-route-53": ["Route 53"],
	"amazon-s3": ["S3"],
	"amazon-s3-glacier": ["S3 Glacier", "Glacier"],
	"amazon-sagemaker": ["SageMaker"],
	"amazon-ses": ["SES"],
	"amazon-sns": ["SNS"],
	"amazon-sqs": ["SQS"],
	"amazon-textract": ["Textract"],
	"amazon-timestream": ["Timestream"],
	"aws-appsync": ["AppSync"],
	"aws-cloudformation": ["CloudFormation"],
	"aws-cloudtrail": ["CloudTrail"],
	"aws-codebuild": ["CodeBuild"],
	"aws-codepipeline": ["CodePipeline"],
	"aws-elastic-beanstalk": ["Elastic Beanstalk"],
	"aws-fargate": ["Fargate"],
	"aws-glue": ["Glue"],
	// "Lambda" also names Lambda Labs' GPU cloud; search gives the term to AWS Lambda (TERM_OWNERS).
	"aws-lambda": ["Lambda"],
	"aws-step-functions": ["Step Functions"],
	"elastic-load-balancing": ["ELB"],
};

/** What architecture labels call the commonest AWS resources. */
const AWS_RESOURCE_NAMES: Readonly<Record<string, readonly string[]>> = {
	"amazon-aurora-instance": ["Aurora instance"],
	"amazon-cloudwatch-alarm": ["CloudWatch alarm"],
	"amazon-dynamodb-table": ["DynamoDB table"],
	"amazon-ebs-volume": ["EBS volume"],
	"amazon-ec2-instance": ["EC2 instance"],
	"amazon-ecs-service": ["ECS service"],
	"amazon-ecs-task": ["ECS task"],
	"amazon-emr-cluster": ["EMR cluster"],
	"amazon-eventbridge-rule": ["EventBridge rule"],
	"amazon-rds-instance": ["RDS instance"],
	"amazon-route-53-hosted-zone": ["Route 53 hosted zone"],
	"amazon-s3-bucket": ["S3 bucket"],
	"amazon-s3-object": ["S3 object"],
	"amazon-sns-topic": ["SNS topic"],
	"amazon-sqs-queue": ["SQS queue"],
	"aws-lambda-function": ["Lambda function"],
	"elastic-load-balancing-application-load-balancer": ["ALB"],
	"elastic-load-balancing-network-load-balancer": ["NLB"],
};

/** Extra search names for a vendor mark, from its collection, slug and name. */
export function vendorAliases(icon: {
	readonly collection: string;
	readonly name: string;
	readonly slug: string;
}): readonly string[] {
	if (icon.collection === "aws-resources") return AWS_RESOURCE_NAMES[icon.slug] ?? [];
	const bare = icon.collection === "aws" ? AWS_BARE_NAMES[icon.slug] : undefined;
	if (!bare) return [];
	// "Amazon S3" is also written "AWS S3", and "AWS Glue" "Amazon Glue".
	const swapped = icon.name.startsWith("Amazon ")
		? [`AWS ${icon.name.slice("Amazon ".length)}`]
		: icon.name.startsWith("AWS ")
			? [`Amazon ${icon.name.slice("AWS ".length)}`]
			: [];
	return [...swapped, ...bare];
}

/** Every slug the lists above name, so a test can hold them to the catalog. */
export const VENDOR_ALIAS_SLUGS: readonly string[] = [
	...Object.keys(AWS_BARE_NAMES),
	...Object.keys(AWS_RESOURCE_NAMES),
];
